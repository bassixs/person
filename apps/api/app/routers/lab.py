"""Лаборатория персоны: /personas/{id}/lab.

Прогоны, набор тестов, сравнение с утверждённой версией.
"""

from uuid import UUID

from fastapi import APIRouter, Request
from sqlalchemy import select

from app.ai import lab as skill
from app.deps import DB, CurrentUser
from app.errors import not_found
from app.models import LabRun, Persona, PersonaVersion
from app.rbac import Perm
from app.schemas import LabGroupOut, LabOverviewOut, LabRunOut
from app.services import lab as lsvc
from app.services import personas as psvc

router = APIRouter(prefix="/personas", tags=["lab"])


def _persona(db: DB, p: CurrentUser, persona_id: UUID) -> Persona:
    p.require(Perm.PERSONA_READ_ALL)
    return psvc.visible_persona(db, p, persona_id)


def _out(db: DB, run: LabRun, _current_hash: str | None = None) -> LabRunOut:
    out = LabRunOut.model_validate(run)
    v = db.get(PersonaVersion, run.version_id)
    # Прогон актуален, пока содержимое его версии не менялось (в т.ч. после активации).
    out.is_current = v is not None and run.content_hash == v.content_hash
    out.version_label = v.label if v else None
    return out


def _draft_hash(db: DB, persona: Persona) -> str | None:
    return db.scalar(
        select(PersonaVersion.content_hash).where(
            PersonaVersion.persona_id == persona.id, PersonaVersion.state == "draft"
        )
    )


@router.get("/{persona_id}/lab", response_model=LabOverviewOut)
def overview(persona_id: UUID, db: DB, p: CurrentUser) -> LabOverviewOut:
    persona = _persona(db, p, persona_id)
    lsvc.expire_stuck(db, persona.id)
    db.commit()
    h = _draft_hash(db, persona)
    runs = db.scalars(
        select(LabRun)
        .where(LabRun.persona_id == persona.id)
        .order_by(LabRun.created_at.desc())
        .limit(10)
    ).all()
    baseline = None
    if persona.active_version_id:
        b = db.scalar(
            select(LabRun)
            .where(LabRun.version_id == persona.active_version_id, LabRun.status == "done")
            .order_by(LabRun.finished_at.desc())
        )
        baseline = _out(db, b, h) if b else None
    return LabOverviewOut(
        suite_version=skill.SUITE_VERSION,
        groups=[
            LabGroupOut(
                key=g.key,
                title=g.title,
                goal=g.goal,
                cases=[{"key": c.key, "prompt": c.prompt} for c in skill.SUITE if c.group == g.key],
            )
            for g in skill.GROUPS.values()
        ],
        runs=[_out(db, r, h) for r in runs],
        baseline=baseline,
    )


@router.post("/{persona_id}/lab/runs", response_model=LabRunOut, status_code=202)
def start(persona_id: UUID, db: DB, p: CurrentUser, request: Request) -> LabRunOut:
    persona = _persona(db, p, persona_id)
    p.require(Perm.PERSONA_EDIT)
    run = lsvc.start(db, p, persona, request)
    db.commit()
    if run.status == "queued":
        lsvc.schedule(run)
    db.refresh(run)
    return _out(db, run, _draft_hash(db, persona))


@router.get("/{persona_id}/lab/runs/{run_id}", response_model=LabRunOut)
def get_run(persona_id: UUID, run_id: UUID, db: DB, p: CurrentUser) -> LabRunOut:
    persona = _persona(db, p, persona_id)
    run = db.get(LabRun, run_id)
    if run is None or run.persona_id != persona.id:
        raise not_found("Прогон лаборатории")
    return _out(db, run, _draft_hash(db, persona))
