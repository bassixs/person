"""Проверка целостности и «светофор»: /personas/{id}/validations, /personas/{id}/consistency.

Читать — тем, кто видит черновики; запускать и превращать замечания в предложения —
тем, кто их правит.
"""

from uuid import UUID

from fastapi import APIRouter, Request
from sqlalchemy import select

from app.ai.decisions import decisions_configured
from app.deps import DB, CurrentUser
from app.errors import not_found
from app.models import Persona, PersonaVersion, ValidationIssue, ValidationRun
from app.rbac import Perm
from app.schemas import ProposalApiOut, SignalOut, ValidationRunOut, ValidationStartIn
from app.services import personas as psvc
from app.services import validation as vsvc

router = APIRouter(prefix="/personas", tags=["validation"])


def _persona(db: DB, p: CurrentUser, persona_id: UUID) -> Persona:
    p.require(Perm.PERSONA_READ_ALL)
    return psvc.visible_persona(db, p, persona_id)


def _out(run: ValidationRun, current_hash: str | None) -> ValidationRunOut:
    out = ValidationRunOut.model_validate(run)
    out.is_current = run.content_hash == current_hash
    return out


def _current_hash(db: DB, persona: Persona) -> str | None:
    return db.scalar(
        select(PersonaVersion.content_hash).where(
            PersonaVersion.persona_id == persona.id, PersonaVersion.state == "draft"
        )
    )


@router.get("/{persona_id}/validations", response_model=list[ValidationRunOut])
def list_runs(persona_id: UUID, db: DB, p: CurrentUser) -> list[ValidationRunOut]:
    persona = _persona(db, p, persona_id)
    vsvc.expire_stuck(db, persona.id)
    db.commit()
    runs = db.scalars(
        select(ValidationRun)
        .where(ValidationRun.persona_id == persona.id)
        .order_by(ValidationRun.created_at.desc())
        .limit(20)
    ).all()
    h = _current_hash(db, persona)
    return [_out(r, h) for r in runs]


@router.post("/{persona_id}/validations", response_model=ValidationRunOut, status_code=202)
def start_run(
    persona_id: UUID, body: ValidationStartIn, db: DB, p: CurrentUser, request: Request
) -> ValidationRunOut:
    persona = _persona(db, p, persona_id)
    p.require(Perm.PERSONA_EDIT)
    run = vsvc.start(db, p, persona, body.kind, request)
    db.commit()
    if run.status == "queued":
        vsvc.schedule(run)
    db.refresh(run)
    return _out(run, _current_hash(db, persona))


@router.get("/{persona_id}/validations/{run_id}", response_model=ValidationRunOut)
def get_run(persona_id: UUID, run_id: UUID, db: DB, p: CurrentUser) -> ValidationRunOut:
    persona = _persona(db, p, persona_id)
    run = db.get(ValidationRun, run_id)
    if run is None or run.persona_id != persona.id:
        raise not_found("Проверка")
    return _out(run, _current_hash(db, persona))


@router.post(
    "/{persona_id}/validations/{run_id}/issues/{issue_id}/propose",
    response_model=ProposalApiOut,
    status_code=201,
)
def propose_fix(
    persona_id: UUID, run_id: UUID, issue_id: UUID, db: DB, p: CurrentUser, request: Request
):
    persona = _persona(db, p, persona_id)
    p.require(Perm.PERSONA_EDIT)
    issue = db.get(ValidationIssue, issue_id)
    if issue is None or issue.run_id != run_id:
        raise not_found("Замечание")
    run = db.get(ValidationRun, run_id)
    if run is None or run.persona_id != persona.id:
        raise not_found("Проверка")
    pr = vsvc.propose_fix(db, p, persona, issue, request)
    db.commit()
    db.refresh(pr)
    return pr


@router.get("/{persona_id}/consistency", response_model=SignalOut)
def consistency(persona_id: UUID, db: DB, p: CurrentUser) -> SignalOut:
    """«Светофор» для текущего черновика; если ещё не посчитан — ставит расчёт в очередь."""
    persona = _persona(db, p, persona_id)
    version = db.scalar(
        select(PersonaVersion).where(
            PersonaVersion.persona_id == persona.id, PersonaVersion.state == "draft"
        )
    )
    if version is None or not decisions_configured():
        return SignalOut(status="unavailable")
    sig = vsvc.current_signal(db, version)
    if sig is None:
        vsvc.schedule_signal(version, p.user.id)
        db.expire_all()
        sig = vsvc.current_signal(db, version)
        if sig is None:
            return SignalOut(status="pending", content_hash=version.content_hash)
    return SignalOut(
        status="ready",
        level=sig.level,  # type: ignore[arg-type]
        p_conflict=sig.p_conflict,
        severity=sig.severity,
        model=sig.model,
        content_hash=sig.content_hash,
    )
