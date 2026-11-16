"""Обзор, интеграции, аудит, health/ready."""

from typing import Literal

from fastapi import APIRouter, Query
from sqlalchemy import func, select, text

from app.deps import DB, CurrentUser
from app.errors import ApiError
from app.integrations.llm import llm_check, llm_status
from app.integrations.max import max_check, max_status
from app.integrations.search import search_status
from app.models import AuditEvent, Persona
from app.rbac import Perm
from app.schemas import AuditOut, Page, UserRef

router = APIRouter(tags=["system"])
health_router = APIRouter(tags=["health"])


@health_router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@health_router.get("/ready")
def ready(db: DB) -> dict:
    try:
        db.execute(text("SELECT 1"))
        rev = db.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except Exception as e:  # noqa: BLE001
        raise ApiError(503, "not_ready", f"База данных недоступна: {type(e).__name__}") from e
    return {"status": "ready", "db": "ok", "migration": rev}


def _integrations() -> list[dict]:
    return [llm_status(), search_status(), max_status()]


@router.get("/integrations/status")
def integrations_status(_: CurrentUser) -> list[dict]:
    return _integrations()


@router.post("/integrations/{name}/check")
def integrations_check(name: Literal["llm", "max"], p: CurrentUser) -> dict:
    p.require(Perm.INTEGRATIONS_DIAGNOSE)
    return llm_check() if name == "llm" else max_check()


def audit_out(e: AuditEvent) -> AuditOut:
    return AuditOut(
        id=e.id,
        occurred_at=e.occurred_at,
        actor=UserRef(id=e.actor.id, display_name=e.actor.display_name) if e.actor else None,
        action=e.action,
        entity_type=e.entity_type,
        entity_id=e.entity_id,
        entity_version=e.entity_version,
        details=e.details,
    )


@router.get("/audit", response_model=Page[AuditOut])
def list_audit(
    db: DB,
    p: CurrentUser,
    entity_id: str | None = None,
    action: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> Page[AuditOut]:
    p.require(Perm.AUDIT_READ)
    stmt = select(AuditEvent)
    if entity_id:
        stmt = stmt.where(AuditEvent.entity_id == entity_id)
    if action:
        stmt = stmt.where(AuditEvent.action == action)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(AuditEvent.occurred_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return Page(items=[audit_out(e) for e in rows], total=total, page=page, page_size=page_size)


@router.get("/overview")
def overview(db: DB, p: CurrentUser) -> dict:
    """Только реальные данные из БД. Модули следующих итераций отдаются как available=false."""
    personas: dict | None = None
    if p.has(Perm.PERSONA_READ_ALL):
        status_rows = db.execute(
            select(Persona.status, func.count()).group_by(Persona.status)
        ).all()
        counts: dict[str, int] = {status: n for status, n in status_rows}
        personas = {
            "total": sum(v for k, v in counts.items() if k != "archived"),
            "by_status": counts,
            "with_active_version": db.scalar(
                select(func.count()).where(Persona.active_version_id.is_not(None))
            ),
        }
    elif p.has(Perm.PERSONA_READ_ACTIVE):
        n = db.scalar(select(func.count()).where(Persona.active_version_id.is_not(None)))
        personas = {"total": n, "by_status": {}, "with_active_version": n}
    recent = []
    if p.has(Perm.AUDIT_READ):
        rows = db.scalars(
            select(AuditEvent)
            .where(AuditEvent.entity_type.in_(["persona", "persona_version"]))
            .order_by(AuditEvent.occurred_at.desc())
            .limit(8)
        ).all()
        recent = [audit_out(e).model_dump(mode="json") for e in rows]
    not_yet = {"available": False}
    return {
        "personas": personas,
        "topics": {**not_yet, "iteration": 3},
        "tasks": {**not_yet, "iteration": 5},
        "monitoring": {**not_yet, "iteration": 4},
        "proposals": {**not_yet, "iteration": 2},
        "recent_events": recent,
        "integrations": _integrations(),
    }
