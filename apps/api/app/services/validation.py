"""Проверка целостности паспорта и «светофор» согласованности (PROJECT_CONTEXT §7.2, ТЗ §3).

- Проверка (ValidationRun) действительна только для своего content_hash:
  после правки она устаревает.
- kind=check — обычная проверка (`LLM_MODEL_CHECK`), kind=final — финальная перед активацией
  (`LLM_MODEL_FINAL`, решение владельца E-028). Барьер активации учитывает только final.
- «Светофор» — быстрая подсказка Decisions API после каждого изменения; активацию не блокирует.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit, jobs
from app.ai import interviewer as iv
from app.ai import validator as skill
from app.ai.client import SkillCall, llm_configured, run_skill
from app.ai.decisions import DecisionsUnavailable, decide, decisions_configured
from app.config import model_for
from app.db import session_factory
from app.deps import Principal
from app.errors import ApiError
from app.models import (
    ChangeProposal,
    ConsistencySignal,
    Persona,
    PersonaSourceMaterial,
    PersonaVersion,
    ValidationIssue,
    ValidationRun,
)
from app.passport import Passport
from app.services.proposals import get_path

# Задача, «зависшая» дольше этого (например, после перезапуска API), считается сорванной.
STUCK_AFTER = timedelta(minutes=10)


def _draft(db: Session, persona: Persona) -> PersonaVersion:
    if persona.status == "archived":
        raise ApiError(409, "persona_archived", "Личность в архиве")
    v = db.scalar(
        select(PersonaVersion).where(
            PersonaVersion.persona_id == persona.id, PersonaVersion.state == "draft"
        )
    )
    if v is None:
        raise ApiError(409, "no_draft", "Проверяется черновик: создайте новую версию")
    return v


def _context(db: Session, persona: Persona, version: PersonaVersion) -> str:
    legend = db.scalar(
        select(PersonaSourceMaterial.content).where(
            PersonaSourceMaterial.persona_id == persona.id,
            PersonaSourceMaterial.kind == "original_legend",
        )
    )
    return iv.context_block(persona.display_name, Passport.model_validate(version.passport), legend)


def expire_stuck(db: Session, persona_id: UUID) -> None:
    limit = datetime.now(UTC) - STUCK_AFTER
    for r in db.scalars(
        select(ValidationRun).where(
            ValidationRun.persona_id == persona_id,
            ValidationRun.status.in_(("queued", "running")),
            ValidationRun.created_at < limit,
        )
    ).all():
        r.status = "failed"
        r.error = "Проверка прервана (сервер перезапускался). Запустите снова."
        r.finished_at = datetime.now(UTC)


def start(
    db: Session, p: Principal, persona: Persona, kind: str, request: Request | None = None
) -> ValidationRun:
    if kind not in ("check", "final"):
        raise ApiError(422, "invalid_kind", "Вид проверки: check или final")
    version = _draft(db, persona)
    if not llm_configured():
        raise ApiError(
            503, "llm_not_configured", "ИИ не подключён: проверка целостности недоступна."
        )
    busy = db.scalar(
        select(ValidationRun).where(
            ValidationRun.version_id == version.id,
            ValidationRun.content_hash == version.content_hash,
            ValidationRun.kind == kind,
            ValidationRun.status.in_(("queued", "running")),
        )
    )
    if busy is not None:
        return busy  # такая же проверка этого содержимого уже идёт
    run = ValidationRun(
        persona_id=persona.id,
        version_id=version.id,
        content_hash=version.content_hash,
        kind=kind,
        status="queued",
        model=model_for(kind),
        started_by_id=p.user.id,
    )
    db.add(run)
    db.flush()
    audit.record(
        db,
        actor_id=p.user.id,
        action="persona.validation_start",
        entity_type="persona_version",
        entity_id=version.id,
        entity_version=version.label,
        details={"run_id": str(run.id), "kind": kind, "content_hash": version.content_hash},
        request=request,
    )
    return run


def execute(run_id: UUID) -> None:
    """Фоновая часть: вызывает модель и сохраняет отчёт. Своя сессия БД."""
    with session_factory()() as db:
        run = db.get(ValidationRun, run_id)
        if run is None or run.status != "queued":
            return
        run.status = "running"
        db.commit()
        persona = db.get(Persona, run.persona_id)
        version = db.get(PersonaVersion, run.version_id)
        assert persona is not None and version is not None
        try:
            if version.content_hash != run.content_hash:
                raise ApiError(409, "content_changed", "Паспорт изменился до начала проверки")
            result, model = run_skill(
                SkillCall(
                    skill=skill.SKILL,
                    version=skill.VERSION,
                    system=skill.SYSTEM,
                    user=skill.prompt(_context(db, persona, version)),
                    actor_id=run.started_by_id,
                    entity_type="persona",
                    entity_id=str(persona.id),
                    model=run.model,
                ),
                skill.ValidationOut,
            )
        except ApiError as e:
            run.status = "failed"
            run.error = e.message
            run.finished_at = datetime.now(UTC)
            db.commit()
            return
        for i, it in enumerate(result.issues):
            run.issues.append(
                ValidationIssue(
                    position=i,
                    severity=it.severity,
                    severity_rank=skill.SEVERITY_RANK[it.severity],
                    kind=it.kind,
                    title=it.title,
                    explanation=it.explanation,
                    field_paths=it.field_paths,
                    suggestion=it.suggestion,
                    fix_field_path=it.fix.field_path if it.fix else None,
                    fix_value=it.fix.value if it.fix else None,
                )
            )
        run.critical_count = sum(1 for x in result.issues if x.severity == "critical")
        run.warning_count = sum(1 for x in result.issues if x.severity == "warning")
        run.info_count = sum(1 for x in result.issues if x.severity == "info")
        run.summary = result.summary or None
        run.model = model or run.model
        run.status = "done"
        run.finished_at = datetime.now(UTC)
        audit.record(
            db,
            actor_id=run.started_by_id,
            action="persona.validation_done",
            entity_type="persona_version",
            entity_id=version.id,
            entity_version=version.label,
            details={
                "run_id": str(run.id),
                "kind": run.kind,
                "content_hash": run.content_hash,
                "critical": run.critical_count,
                "warning": run.warning_count,
                "model": run.model,
            },
        )
        db.commit()


def schedule(run: ValidationRun) -> None:
    jobs.submit(execute, run.id)


def propose_fix(
    db: Session, p: Principal, persona: Persona, issue: ValidationIssue, request: Request | None
) -> ChangeProposal:
    """Исправление из отчёта → обычное предложение в очереди (решает редактор)."""
    if issue.proposal_id is not None:
        existing = db.get(ChangeProposal, issue.proposal_id)
        if existing is not None:
            return existing
    if not issue.fix_field_path:
        raise ApiError(409, "no_fix", "У этого замечания нет готового исправления")
    run = db.get(ValidationRun, issue.run_id)
    version = _draft(db, persona)
    assert run is not None
    if run.version_id != version.id:
        raise ApiError(409, "run_outdated", "Проверка относится к другой версии")
    passport = Passport.model_validate(version.passport)
    before = get_path(passport, issue.fix_field_path)
    pr = ChangeProposal(
        persona_id=persona.id,
        version_id=version.id,
        origin="validation",
        field_path=issue.fix_field_path,
        before_value=before,
        proposed_value=issue.fix_value,
        proposed_certainty="hypothesis",
        rationale=f"{issue.title}. {issue.explanation}"[:1500],
        related_paths=[x for x in issue.field_paths if x != issue.fix_field_path],
        base_content_hash=version.content_hash,
        status="pending",
        generator={"skill": skill.SKILL, "version": skill.VERSION, "model": run.model},
        created_by_id=p.user.id,
    )
    db.add(pr)
    db.flush()
    issue.proposal_id = pr.id
    audit.record(
        db,
        actor_id=p.user.id,
        action="persona.validation_fix_proposed",
        entity_type="persona_version",
        entity_id=version.id,
        entity_version=version.label,
        details={"issue_id": str(issue.id), "proposal_id": str(pr.id), "field_path": pr.field_path},
        request=request,
    )
    return pr


# ---------- «Светофор» ----------


def compute_signal(version_id: UUID, content_hash: str, actor_id: UUID | None) -> None:
    """Фоновая задача: Decisions API → уровень для конкретного content_hash."""
    with session_factory()() as db:
        version = db.get(PersonaVersion, version_id)
        if version is None or version.content_hash != content_hash:
            return  # паспорт уже поменялся — посчитаем для нового содержимого
        if db.scalar(
            select(ConsistencySignal.id).where(
                ConsistencySignal.version_id == version_id,
                ConsistencySignal.content_hash == content_hash,
            )
        ):
            return
        state = skill.signal_state(iv._passport_view(Passport.model_validate(version.passport)))
        try:
            answers, model = decide(
                "consistency-signal",
                state,
                skill.SIGNAL_QUESTIONS,
                actor_id=actor_id,
                entity_type="persona_version",
                entity_id=str(version_id),
            )
            level, p, sev = skill.signal_level(answers)
            db.add(
                ConsistencySignal(
                    version_id=version_id,
                    content_hash=content_hash,
                    level=level,
                    p_conflict=p,
                    severity=sev,
                    model=model,
                )
            )
        except DecisionsUnavailable:
            db.add(
                ConsistencySignal(
                    version_id=version_id, content_hash=content_hash, level="error", model=None
                )
            )
        db.commit()


def schedule_signal(version: PersonaVersion, actor_id: UUID | None) -> None:
    if version.state == "draft" and decisions_configured():
        jobs.submit(compute_signal, version.id, version.content_hash, actor_id)


def current_signal(db: Session, version: PersonaVersion) -> ConsistencySignal | None:
    return db.scalar(
        select(ConsistencySignal)
        .where(
            ConsistencySignal.version_id == version.id,
            ConsistencySignal.content_hash == version.content_hash,
        )
        .order_by(ConsistencySignal.created_at.desc())
    )


def current_final(db: Session, version: PersonaVersion) -> ValidationRun | None:
    return db.scalar(
        select(ValidationRun)
        .where(
            ValidationRun.version_id == version.id,
            ValidationRun.content_hash == version.content_hash,
            ValidationRun.kind == "final",
            ValidationRun.status == "done",
        )
        .order_by(ValidationRun.finished_at.desc())
    )
