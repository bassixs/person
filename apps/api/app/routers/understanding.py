"""Карточка понимания темы: /topics/{id}/understanding."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.ai.client import llm_configured
from app.deps import DB, CurrentUser
from app.errors import not_found
from app.models import TopicUnderstandingRun
from app.rbac import Perm
from app.schemas import UserRef
from app.services import topics as tsvc
from app.services import understanding as svc

router = APIRouter(prefix="/topics", tags=["understanding"])


class UnderstandingRunOut(BaseModel):
    id: UUID
    version_id: UUID
    content_hash: str
    status: str
    model: str | None
    skill_version: str
    card: dict[str, Any] | None
    materials: list[dict[str, Any]]
    error: str | None
    is_current: bool
    started_by: UserRef | None
    created_at: datetime
    finished_at: datetime | None


class UnderstandingOverview(BaseModel):
    available: bool
    materials_count: int
    has_draft: bool
    latest: UnderstandingRunOut | None


class ApplyIn(BaseModel):
    kind: Literal["fact", "unverified", "conflict", "question", "gap"]
    index: int = Field(ge=0, le=1000)


def _out(db: DB, run: TopicUnderstandingRun) -> UnderstandingRunOut:
    u = run.started_by
    return UnderstandingRunOut(
        id=run.id,
        version_id=run.version_id,
        content_hash=run.content_hash,
        status=run.status,
        model=run.model,
        skill_version=run.skill_version,
        card=run.card,
        materials=run.materials,
        error=run.error,
        is_current=run.status == "done" and svc.is_current(db, run),
        started_by=UserRef(id=u.id, display_name=u.display_name) if u else None,
        created_at=run.created_at,
        finished_at=run.finished_at,
    )


def _topic(db: DB, p: CurrentUser, topic_id: UUID):  # type: ignore[no-untyped-def]
    p.require(Perm.TOPIC_READ_ALL)
    return tsvc.visible_topic(db, p, topic_id)


@router.get("/{topic_id}/understanding", response_model=UnderstandingOverview)
def overview(topic_id: UUID, db: DB, p: CurrentUser) -> UnderstandingOverview:
    topic = _topic(db, p, topic_id)
    svc.expire_stuck(db, topic.id)
    db.commit()
    run = svc.latest(db, topic.id)
    return UnderstandingOverview(
        available=llm_configured(),
        materials_count=len(svc.topic_materials(db, topic.id)),
        has_draft=tsvc.current_draft(db, topic.id) is not None,
        latest=_out(db, run) if run else None,
    )


@router.post("/{topic_id}/understanding", response_model=UnderstandingRunOut, status_code=202)
def start(topic_id: UUID, request: Request, db: DB, p: CurrentUser) -> UnderstandingRunOut:
    topic = _topic(db, p, topic_id)
    p.require(Perm.TOPIC_EDIT)
    run = svc.start(db, p, topic, request)
    db.commit()
    if run.status == "queued":
        svc.schedule(run)
    db.refresh(run)
    return _out(db, run)


@router.get("/{topic_id}/understanding/{run_id}", response_model=UnderstandingRunOut)
def get_run(topic_id: UUID, run_id: UUID, db: DB, p: CurrentUser) -> UnderstandingRunOut:
    topic = _topic(db, p, topic_id)
    run = db.get(TopicUnderstandingRun, run_id)
    if run is None or run.topic_id != topic.id:
        raise not_found("Карточка понимания")
    return _out(db, run)


@router.post("/{topic_id}/understanding/{run_id}/apply")
def apply(
    topic_id: UUID, run_id: UUID, body: ApplyIn, request: Request, db: DB, p: CurrentUser
) -> dict:
    topic = _topic(db, p, topic_id)
    p.require(Perm.TOPIC_EDIT)
    run = db.get(TopicUnderstandingRun, run_id)
    if run is None or run.topic_id != topic.id:
        raise not_found("Карточка понимания")
    draft = svc.apply_item(db, p, topic, run, body.kind, body.index, request)
    db.commit()
    return {
        "version_id": str(draft.id),
        "revision": draft.revision,
        "content_hash": draft.content_hash,
    }
