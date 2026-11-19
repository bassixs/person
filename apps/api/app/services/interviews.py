"""ИИ-интервью по черновику (ТЗ §3): адаптивные раунды по 3–5 вопросов.

Редактор отвечает свободным текстом, «неизвестно» или пропускает вопрос; может завершить досрочно.
Ответы превращаются только в предложения (очередь), паспорт интервью не меняет.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.ai import interviewer as skill
from app.ai.client import SkillCall, run_skill
from app.deps import Principal
from app.errors import ApiError
from app.models import (
    ChangeProposal,
    InterviewAnswer,
    InterviewSession,
    Persona,
    PersonaSourceMaterial,
    PersonaVersion,
)
from app.passport import Passport, schema_document
from app.services.proposals import create_from_ai


def _draft(db: Session, persona: Persona) -> PersonaVersion:
    if persona.status == "archived":
        raise ApiError(409, "persona_archived", "Личность в архиве")
    v = db.scalar(
        select(PersonaVersion).where(
            PersonaVersion.persona_id == persona.id, PersonaVersion.state == "draft"
        )
    )
    if v is None:
        raise ApiError(
            409, "no_draft", "Нет черновика: создайте новую версию, чтобы продолжить работу"
        )
    return v


def _context(db: Session, persona: Persona, version: PersonaVersion) -> str:
    legend = db.scalar(
        select(PersonaSourceMaterial.content).where(
            PersonaSourceMaterial.persona_id == persona.id,
            PersonaSourceMaterial.kind == "original_legend",
        )
    )
    return skill.context_block(
        persona.display_name, Passport.model_validate(version.passport), legend
    )


def _call(p: Principal, entity_id: UUID, user: str) -> SkillCall:
    return SkillCall(
        skill=skill.SKILL,
        version=skill.VERSION,
        system=skill.SYSTEM,
        user=user,
        actor_id=p.user.id,
        entity_type="persona",
        entity_id=str(entity_id),
    )


def _add_questions(s: InterviewSession, round_no: int, questions: list[skill.QuestionOut]) -> None:
    for i, q in enumerate(questions):
        s.questions.append(
            InterviewAnswer(
                round_no=round_no,
                position=i,
                question=q.question.strip(),
                why=q.why.strip(),
                field_paths=q.field_paths,
            )
        )
    s.rounds = round_no


def active_session(db: Session, persona: Persona) -> InterviewSession | None:
    return db.scalar(
        select(InterviewSession).where(
            InterviewSession.persona_id == persona.id, InterviewSession.status == "active"
        )
    )


def start(
    db: Session, p: Principal, persona: Persona, request: Request | None = None
) -> InterviewSession:
    version = _draft(db, persona)
    existing = active_session(db, persona)
    if existing is not None:
        if existing.version_id == version.id:
            return existing  # продолжаем незавершённое интервью
        existing.status = "completed"
        existing.completed_at = datetime.now(UTC)
    result, model = run_skill(
        _call(p, persona.id, skill.first_round_prompt(_context(db, persona, version))),
        skill.RoundOut,
    )
    s = InterviewSession(
        persona_id=persona.id, version_id=version.id, status="active", created_by_id=p.user.id
    )
    db.add(s)
    _add_questions(s, 1, result.questions)
    db.flush()
    audit.record(
        db,
        actor_id=p.user.id,
        action="persona.interview_start",
        entity_type="persona_version",
        entity_id=version.id,
        entity_version=version.label,
        details={"session_id": str(s.id), "model": model, "questions": len(result.questions)},
        request=request,
    )
    return s


@dataclass
class AnswerIn:
    question_id: UUID
    kind: Literal["answered", "unknown", "skipped"]
    text: str | None = None


def submit_round(
    db: Session,
    p: Principal,
    persona: Persona,
    s: InterviewSession,
    answers: list[AnswerIn],
    *,
    finish: bool,
    request: Request | None = None,
) -> list[ChangeProposal]:
    if s.status != "active":
        raise ApiError(409, "interview_completed", "Интервью уже завершено")
    version = _draft(db, persona)
    if version.id != s.version_id:
        raise ApiError(409, "interview_outdated", "Черновик сменился: начните новое интервью")
    current = [q for q in s.questions if q.round_no == s.rounds]
    by_id = {a.question_id: a for a in answers}
    missing = [q for q in current if q.id not in by_id]
    if missing:
        raise ApiError(
            422,
            "answers_incomplete",
            "Ответьте, отметьте «неизвестно» или пропустите каждый вопрос раунда",
        )
    now = datetime.now(UTC)
    for q in current:
        a = by_id[q.id]
        text = (a.text or "").strip()
        if a.kind == "answered" and not text:
            raise ApiError(
                422, "answer_empty", "Пустой ответ: напишите текст или выберите «неизвестно»"
            )
        q.answer_kind = a.kind
        q.answer_text = text if a.kind == "answered" else None
        q.answered_by_id = p.user.id
        q.answered_at = now

    processed_round = s.rounds
    useful = any(q.answer_kind in ("answered", "unknown") for q in current)
    final = finish or s.rounds >= skill.MAX_ROUNDS
    created: list[ChangeProposal] = []
    model = None
    if useful:
        qa = [
            {
                "round": q.round_no,
                "question": q.question,
                "fields": q.field_paths,
                "answer": q.answer_text if q.answer_kind == "answered" else q.answer_kind,
            }
            for q in s.questions
            if q.answer_kind is not None
        ]
        result, model = run_skill(
            _call(
                p,
                persona.id,
                skill.process_prompt(_context(db, persona, version), qa, s.rounds, final),
            ),
            skill.ProcessOut,
        )
        created = create_from_ai(
            db,
            p,
            persona,
            version,
            result.proposals,
            origin="interview",
            session_id=s.id,
            generator={"skill": skill.SKILL, "version": skill.VERSION, "model": model},
        )
        if not final and result.next_questions:
            _add_questions(s, s.rounds + 1, result.next_questions)
        else:
            final = True
    if final:
        s.status = "completed"
        s.completed_at = now
    db.flush()
    audit.record(
        db,
        actor_id=p.user.id,
        action="persona.interview_round",
        entity_type="persona_version",
        entity_id=version.id,
        entity_version=version.label,
        details={
            "session_id": str(s.id),
            "round": processed_round,
            "answered": sum(1 for q in current if q.answer_kind == "answered"),
            "unknown": sum(1 for q in current if q.answer_kind == "unknown"),
            "skipped": sum(1 for q in current if q.answer_kind == "skipped"),
            "proposals": len(created),
            "completed": final,
            "model": model,
        },
        request=request,
    )
    return created


def complete(
    db: Session, p: Principal, s: InterviewSession, request: Request | None = None
) -> None:
    """Досрочное завершение без обработки текущего раунда: вопросы помечаются пропущенными."""
    if s.status != "active":
        return
    now = datetime.now(UTC)
    for q in s.questions:
        if q.answer_kind is None:
            q.answer_kind = "skipped"
            q.answered_by_id = p.user.id
            q.answered_at = now
    s.status = "completed"
    s.completed_at = now
    audit.record(
        db,
        actor_id=p.user.id,
        action="persona.interview_complete",
        entity_type="persona_version",
        entity_id=s.version_id,
        details={"session_id": str(s.id), "rounds": s.rounds},
        request=request,
    )


def deepen(
    db: Session, p: Principal, persona: Persona, section_key: str, request: Request | None = None
) -> list[ChangeProposal]:
    """«Предложить углубление» раздела — ИИ предлагает правки, паспорт не меняется."""
    version = _draft(db, persona)
    doc = {sec["key"]: sec["title"] for sec in schema_document()["sections"]}
    if section_key not in doc:
        raise ApiError(422, "unknown_section", "Неизвестный раздел паспорта")
    result, model = run_skill(
        _call(
            p,
            persona.id,
            skill.deepen_prompt(_context(db, persona, version), section_key, doc[section_key]),
        ),
        skill.DeepenOut,
    )
    items = [x for x in result.proposals if x.field_path.split(".", 1)[0] == section_key]
    created = create_from_ai(
        db,
        p,
        persona,
        version,
        items,
        origin="deepen",
        session_id=None,
        generator={"skill": skill.SKILL, "version": skill.VERSION, "model": model},
    )
    audit.record(
        db,
        actor_id=p.user.id,
        action="persona.deepen",
        entity_type="persona_version",
        entity_id=version.id,
        entity_version=version.label,
        details={"section": section_key, "proposals": len(created), "model": model},
        request=request,
    )
    return created
