"""Интервью и очередь предложений ИИ: /personas/{id}/interviews, /personas/{id}/proposals (ТЗ §6).

Читать — всем, кто видит черновики; запускать интервью и решать по предложениям — тем, кто правит
черновики (editor, author — решение владельца Q-002). Активация здесь не затрагивается.
"""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Query, Request
from sqlalchemy import select

from app.deps import DB, CurrentUser
from app.errors import not_found
from app.models import ChangeProposal, InterviewSession, Persona
from app.rbac import Perm
from app.schemas import (
    AcceptIn,
    DecisionOut,
    DeepenIn,
    InterviewOut,
    ProposalApiOut,
    RejectIn,
    RoundIn,
    RoundOut,
)
from app.services import interviews as isvc
from app.services import personas as psvc
from app.services import proposals as prsvc

router = APIRouter(prefix="/personas", tags=["persona-ai"])


def _persona(db: DB, p: CurrentUser, persona_id: UUID) -> Persona:
    p.require(Perm.PERSONA_READ_ALL)
    return psvc.visible_persona(db, p, persona_id)


def _session(db: DB, persona: Persona, sid: UUID) -> InterviewSession:
    s = db.get(InterviewSession, sid)
    if s is None or s.persona_id != persona.id:
        raise not_found("Интервью")
    return s


def _proposal(db: DB, persona: Persona, prid: UUID) -> ChangeProposal:
    pr = db.get(ChangeProposal, prid)
    if pr is None or pr.persona_id != persona.id:
        raise not_found("Предложение")
    return pr


# ---------- Интервью ----------


@router.get("/{persona_id}/interviews", response_model=list[InterviewOut])
def list_interviews(persona_id: UUID, db: DB, p: CurrentUser) -> list[InterviewSession]:
    persona = _persona(db, p, persona_id)
    return list(
        db.scalars(
            select(InterviewSession)
            .where(InterviewSession.persona_id == persona.id)
            .order_by(InterviewSession.created_at.desc())
            .limit(20)
        ).all()
    )


@router.post("/{persona_id}/interviews", response_model=InterviewOut, status_code=201)
def start_interview(persona_id: UUID, db: DB, p: CurrentUser, request: Request) -> InterviewSession:
    persona = _persona(db, p, persona_id)
    p.require(Perm.PERSONA_EDIT)
    s = isvc.start(db, p, persona, request)
    db.commit()
    db.refresh(s)
    return s


@router.get("/{persona_id}/interviews/{sid}", response_model=InterviewOut)
def get_interview(persona_id: UUID, sid: UUID, db: DB, p: CurrentUser) -> InterviewSession:
    return _session(db, _persona(db, p, persona_id), sid)


@router.post("/{persona_id}/interviews/{sid}/rounds", response_model=RoundOut)
def submit_round(
    persona_id: UUID, sid: UUID, body: RoundIn, db: DB, p: CurrentUser, request: Request
) -> RoundOut:
    persona = _persona(db, p, persona_id)
    p.require(Perm.PERSONA_EDIT)
    s = _session(db, persona, sid)
    created = isvc.submit_round(
        db,
        p,
        persona,
        s,
        [isvc.AnswerIn(a.question_id, a.kind, a.text) for a in body.answers],
        finish=body.finish,
        request=request,
    )
    db.commit()
    db.refresh(s)
    return RoundOut(interview=InterviewOut.model_validate(s), proposals_created=len(created))


@router.post("/{persona_id}/interviews/{sid}/complete", response_model=InterviewOut)
def complete_interview(
    persona_id: UUID, sid: UUID, db: DB, p: CurrentUser, request: Request
) -> InterviewSession:
    persona = _persona(db, p, persona_id)
    p.require(Perm.PERSONA_EDIT)
    s = _session(db, persona, sid)
    isvc.complete(db, p, s, request)
    db.commit()
    db.refresh(s)
    return s


# ---------- Предложения ----------


@router.get("/{persona_id}/proposals", response_model=list[ProposalApiOut])
def list_proposals(
    persona_id: UUID,
    db: DB,
    p: CurrentUser,
    status: Literal["pending", "accepted", "rejected", "stale", "all"] = Query(default="pending"),
) -> list[ChangeProposal]:
    persona = _persona(db, p, persona_id)
    stmt = select(ChangeProposal).where(ChangeProposal.persona_id == persona.id)
    if status != "all":
        stmt = stmt.where(ChangeProposal.status == status)
    return list(db.scalars(stmt.order_by(ChangeProposal.created_at.desc()).limit(200)).all())


@router.post("/{persona_id}/proposals/deepen", response_model=list[ProposalApiOut], status_code=201)
def deepen(
    persona_id: UUID, body: DeepenIn, db: DB, p: CurrentUser, request: Request
) -> list[ChangeProposal]:
    persona = _persona(db, p, persona_id)
    p.require(Perm.PERSONA_EDIT)
    created = isvc.deepen(db, p, persona, body.section, request)
    db.commit()
    for c in created:
        db.refresh(c)
    return created


@router.post("/{persona_id}/proposals/{prid}/accept", response_model=DecisionOut)
def accept(
    persona_id: UUID, prid: UUID, body: AcceptIn, db: DB, p: CurrentUser, request: Request
) -> DecisionOut:
    persona = _persona(db, p, persona_id)
    p.require(Perm.PERSONA_EDIT)
    pr = _proposal(db, persona, prid)
    try:
        version = prsvc.accept(
            db,
            p,
            persona,
            pr,
            expected_revision=body.expected_revision,
            value=body.value,
            certainty=body.certainty,
            note=body.note,
            request=request,
        )
    except Exception:
        # Если предложение успело устареть — фиксируем это, а не откатываем.
        if pr.status == "stale":
            db.commit()
        else:
            db.rollback()
        raise
    db.commit()
    db.refresh(pr)
    return DecisionOut(
        proposal=ProposalApiOut.model_validate(pr),
        revision=version.revision,
        content_hash=version.content_hash,
    )


@router.post("/{persona_id}/proposals/{prid}/reject", response_model=ProposalApiOut)
def reject(
    persona_id: UUID, prid: UUID, body: RejectIn, db: DB, p: CurrentUser, request: Request
) -> ChangeProposal:
    persona = _persona(db, p, persona_id)
    p.require(Perm.PERSONA_EDIT)
    pr = _proposal(db, persona, prid)
    prsvc.reject(db, p, pr, note=body.note, request=request)
    db.commit()
    db.refresh(pr)
    return pr
