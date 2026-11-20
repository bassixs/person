"""Лаборатория персоны: прогон стандартного набора тестов в фоне (PROJECT_CONTEXT §7.3, ТЗ §3).

Прогон действителен только для своего content_hash.
Барьер активации требует актуальный прогон без critical.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit, jobs
from app.ai import interviewer as iv
from app.ai import lab as skill
from app.ai import validator as vskill
from app.ai.client import SkillCall, llm_configured, run_skill
from app.ai.decisions import DecisionsUnavailable, decide, decisions_configured
from app.config import get_settings, model_for
from app.db import session_factory
from app.deps import Principal
from app.errors import ApiError
from app.models import LabResult, LabRun, Persona, PersonaVersion
from app.passport import Passport
from app.services.validation import _context, _draft

STUCK_AFTER = timedelta(minutes=15)


def expire_stuck(db: Session, persona_id: UUID) -> None:
    limit = datetime.now(UTC) - STUCK_AFTER
    for r in db.scalars(
        select(LabRun).where(
            LabRun.persona_id == persona_id,
            LabRun.status.in_(("queued", "running")),
            LabRun.created_at < limit,
        )
    ).all():
        r.status = "failed"
        r.error = "Прогон прерван (сервер перезапускался). Запустите снова."
        r.finished_at = datetime.now(UTC)


def start(db: Session, p: Principal, persona: Persona, request: Request | None = None) -> LabRun:
    version = _draft(db, persona)
    if not llm_configured():
        raise ApiError(503, "llm_not_configured", "ИИ не подключён: лаборатория недоступна.")
    busy = db.scalar(
        select(LabRun).where(
            LabRun.version_id == version.id,
            LabRun.content_hash == version.content_hash,
            LabRun.status.in_(("queued", "running")),
        )
    )
    if busy is not None:
        return busy
    s = get_settings()
    run = LabRun(
        persona_id=persona.id,
        version_id=version.id,
        content_hash=version.content_hash,
        suite_version=skill.SUITE_VERSION,
        status="queued",
        models={
            "simulator": model_for("interview"),
            "judge": s.decisions_model if decisions_configured() else model_for("check"),
            "explainer": model_for("check"),
        },
        started_by_id=p.user.id,
    )
    db.add(run)
    db.flush()
    audit.record(
        db,
        actor_id=p.user.id,
        action="persona.lab_start",
        entity_type="persona_version",
        entity_id=version.id,
        entity_version=version.label,
        details={
            "run_id": str(run.id),
            "content_hash": version.content_hash,
            "suite": skill.SUITE_VERSION,
        },
        request=request,
    )
    return run


def _call(
    run: LabRun, persona: Persona, name: str, version: str, system: str, user: str, role: str
) -> SkillCall:
    return SkillCall(
        skill=name,
        version=version,
        system=system,
        user=user,
        actor_id=run.started_by_id,
        entity_type="persona",
        entity_id=str(persona.id),
        model=model_for(role),
    )


def execute(run_id: UUID) -> None:
    with session_factory()() as db:
        run = db.get(LabRun, run_id)
        if run is None or run.status != "queued":
            return
        run.status = "running"
        db.commit()
        persona = db.get(Persona, run.persona_id)
        version = db.get(PersonaVersion, run.version_id)
        assert persona is not None and version is not None
        try:
            if version.content_hash != run.content_hash:
                raise ApiError(409, "content_changed", "Паспорт изменился до начала прогона")
            ctx = _context(db, persona, version)
            # 1. Модель персоны отвечает на тест-кейсы
            sim, _ = run_skill(
                _call(
                    run,
                    persona,
                    skill.SIM_SKILL,
                    skill.SIM_VERSION,
                    skill.SIM_SYSTEM,
                    skill.sim_prompt(ctx),
                    "interview",
                ),
                skill.SimOut,
            )
            responses = {a.case_key: a.response for a in sim.answers}
            filled = vskill.signal_state(
                iv._passport_view(Passport.model_validate(version.passport))
            )["persona_passport"]

            # 2. Вердикты: Decisions по рубрике группы; без него — LLM-судья
            verdicts: dict[str, tuple[str, float | None]] = {}
            if decisions_configured():
                for case in skill.SUITE:
                    try:
                        answers, _ = decide(
                            "persona-lab-verdict",
                            skill.decision_state(filled, case, responses[case.key]),
                            skill.decision_question(case),
                            actor_id=run.started_by_id,
                            entity_type="persona",
                            entity_id=str(persona.id),
                        )
                        a = answers.get("verdict") or {}
                        if a.get("choice") in ("pass", "warning", "critical"):
                            verdicts[case.key] = (a["choice"], a.get("confidence"))
                    except DecisionsUnavailable:
                        pass  # недооценённые кейсы оценит LLM-судья ниже

            rows = [
                {
                    "case_key": c.key,
                    "response": responses[c.key],
                    "verdict": verdicts.get(c.key, (None,))[0],
                }
                for c in skill.SUITE
            ]
            # 3. Объяснения — для warning/critical и для всего, что не оценено
            need = [r for r in rows if r["verdict"] != "pass"]
            notes: dict[str, skill.JudgeItem] = {}
            if need:
                judged, _ = run_skill(
                    _call(
                        run,
                        persona,
                        skill.JUDGE_SKILL,
                        skill.JUDGE_VERSION,
                        skill.JUDGE_SYSTEM,
                        skill.judge_prompt(ctx, need),
                        "check",
                    ),
                    skill.JudgeOut,
                )
                notes = {i.case_key: i for i in judged.items}
        except ApiError as e:
            run.status = "failed"
            run.error = e.message
            run.finished_at = datetime.now(UTC)
            db.commit()
            return

        for i, case in enumerate(skill.SUITE):
            verdict, conf = verdicts.get(case.key, (None, None))
            note = notes.get(case.key)
            if verdict is None:
                verdict = (note.verdict if note and note.verdict else None) or "warning"
                conf = None
            run.results.append(
                LabResult(
                    position=i,
                    lab_group=case.group,
                    case_key=case.key,
                    prompt=case.prompt,
                    response=responses[case.key],
                    verdict=verdict,
                    confidence=conf,
                    explanation=note.explanation if note and verdict != "pass" else None,
                    suggestion=note.suggestion if note and verdict != "pass" else None,
                )
            )
        run.pass_count = sum(1 for r in run.results if r.verdict == "pass")
        run.warning_count = sum(1 for r in run.results if r.verdict == "warning")
        run.critical_count = sum(1 for r in run.results if r.verdict == "critical")
        run.status = "done"
        run.finished_at = datetime.now(UTC)
        audit.record(
            db,
            actor_id=run.started_by_id,
            action="persona.lab_done",
            entity_type="persona_version",
            entity_id=version.id,
            entity_version=version.label,
            details={
                "run_id": str(run.id),
                "content_hash": run.content_hash,
                "pass": run.pass_count,
                "warning": run.warning_count,
                "critical": run.critical_count,
            },
        )
        db.commit()


def schedule(run: LabRun) -> None:
    jobs.submit(execute, run.id)


def current_run(db: Session, version: PersonaVersion) -> LabRun | None:
    return db.scalar(
        select(LabRun)
        .where(
            LabRun.version_id == version.id,
            LabRun.content_hash == version.content_hash,
            LabRun.status == "done",
        )
        .order_by(LabRun.finished_at.desc())
    )
