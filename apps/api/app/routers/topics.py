"""Темы: /topics (итерация 3). Права — только через rbac.Perm, правила — в services/topics."""

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, or_, select

from app import audit
from app.deps import DB, CurrentUser, Principal
from app.errors import ApiError, forbidden
from app.models import AuditEvent, Topic, TopicClaimFlag, TopicVersion, User
from app.rbac import Perm
from app.routers.system import audit_out
from app.schemas import AuditOut, Page, UserRef
from app.services import topics as svc
from app.topic_dossier import safe_to_use, schema_document
from app.topic_schemas import (
    ActivationCheck,
    Blocker,
    ClaimFlagIn,
    ClaimFlagOut,
    ClaimHistoryEntry,
    EffectiveClaim,
    TopicCapabilities,
    TopicCounts,
    TopicCreate,
    TopicDetail,
    TopicListItem,
    TopicPatch,
    TopicSuspendIn,
    TopicVersionDetail,
    TopicVersionIn,
    TopicVersionRef,
    TopicVersionSummary,
    TopicVersionUpdate,
)

router = APIRouter(prefix="/topics", tags=["topics"])


def _ref(u: User | None) -> UserRef | None:
    return UserRef(id=u.id, display_name=u.display_name) if u else None


def _vref(v: TopicVersion | None) -> TopicVersionRef | None:
    if v is None:
        return None
    return TopicVersionRef(
        id=v.id, label=v.label, state=v.state, content_hash=v.content_hash, revision=v.revision
    )


def _flag_out(f: TopicClaimFlag) -> ClaimFlagOut:
    return ClaimFlagOut(
        id=f.id,
        claim_id=f.claim_id,
        version_id=f.version_id,
        flag=f.flag,
        reason=f.reason,
        origin=f.origin,
        created_by=_ref(f.created_by),
        created_at=f.created_at,
    )


def _versions(
    db: DB, topic: Topic, p: Principal
) -> tuple[TopicVersion | None, TopicVersion | None]:
    active = db.get(TopicVersion, topic.active_version_id) if topic.active_version_id else None
    draft = svc.current_draft(db, topic.id) if p.has(Perm.TOPIC_READ_ALL) else None
    return active, draft


def _counts(db: DB, topic: Topic, v: TopicVersion | None) -> TopicCounts | None:
    if v is None:
        return None
    d = svc.dossier_of(v)
    verified, unsafe = svc.safe_claim_count(d, svc.current_flags(db, topic.id))
    return TopicCounts(
        claims=len(d.claims), verified=verified, unsafe=unsafe, open_questions=len(d.unknowns)
    )


def _list_item(db: DB, topic: Topic, p: Principal) -> TopicListItem:
    active, draft = _versions(db, topic, p)
    return TopicListItem(
        id=topic.id,
        title=topic.title,
        geography=topic.geography,
        category=topic.category,
        status=topic.status,
        creation_mode=topic.creation_mode,
        active_version=_vref(active),
        draft_version=_vref(draft),
        counts=_counts(db, topic, active or draft),
        created_by=_ref(topic.created_by),
        created_at=topic.created_at,
        updated_at=topic.updated_at,
    )


def _summary(v: TopicVersion) -> TopicVersionSummary:
    return TopicVersionSummary(
        id=v.id,
        label=v.label,
        state=v.state,
        content_hash=v.content_hash,
        change_note=v.change_note,
        created_by=_ref(v.created_by),
        approved_by=_ref(v.approved_by),
        created_at=v.created_at,
        approved_at=v.approved_at,
    )


def _detail(db: DB, topic: Topic, p: Principal) -> TopicDetail:
    base = _list_item(db, topic, p)
    archived = topic.status == "archived"
    versions = [
        _summary(v) for v in topic.versions if p.has(Perm.TOPIC_READ_ALL) or v.state == "active"
    ]
    draft_exists = base.draft_version is not None
    return TopicDetail(
        **base.model_dump(),
        versions=list(reversed(versions)),
        capabilities=TopicCapabilities(
            can_edit=p.has(Perm.TOPIC_EDIT) and not archived,
            can_submit=p.has(Perm.TOPIC_EDIT) and not archived and draft_exists,
            can_activate=p.has(Perm.TOPIC_APPROVE) and not archived and draft_exists,
            can_archive=p.has(Perm.TOPIC_ARCHIVE),
            can_flag=p.has(Perm.TOPIC_APPROVE) and topic.active_version_id is not None,
            can_verify_claims=p.has(Perm.TOPIC_APPROVE),
        ),
        flags=[_flag_out(f) for f in svc.current_flags(db, topic.id).values()]
        if topic.active_version_id
        else [],
    )


def _version_detail(db: DB, topic: Topic, v: TopicVersion) -> TopicVersionDetail:
    d = svc.dossier_of(v)
    flags = svc.current_flags(db, topic.id)
    eff = [
        EffectiveClaim(
            id=c.id,
            effective_status=s,
            safe_to_use=safe_to_use(s),
            flag=_flag_out(f) if f is not None else None,
        )
        for c, s, f in svc.effective_claims(d, flags)
    ]
    return TopicVersionDetail(
        **_summary(v).model_dump(),
        topic_id=topic.id,
        revision=v.revision,
        schema_version=v.schema_version,
        dossier=d,
        claims_effective=eff,
        updated_by=_ref(v.updated_by),
        updated_at=v.updated_at,
    )


def _topic(db: DB, p: CurrentUser, topic_id: UUID) -> Topic:
    return svc.visible_topic(db, p, topic_id)


@router.get("/schema")
def get_schema(_: CurrentUser) -> dict:
    return schema_document()


@router.get("", response_model=Page[TopicListItem])
def list_topics(
    db: DB,
    p: CurrentUser,
    q: str | None = Query(default=None, max_length=200),
    status: Annotated[list[str] | None, Query()] = None,
    category: str | None = Query(default=None, max_length=100),
    geography: str | None = Query(default=None, max_length=300),
    include_archived: bool = False,
    sort: Literal["updated_desc", "title_asc", "created_desc"] = "updated_desc",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> Page[TopicListItem]:
    if not (p.has(Perm.TOPIC_READ_ALL) or p.has(Perm.TOPIC_READ_ACTIVE)):
        raise forbidden()
    stmt = select(Topic)
    if not p.has(Perm.TOPIC_READ_ALL):
        stmt = stmt.where(Topic.active_version_id.is_not(None))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(Topic.title.ilike(like), Topic.geography.ilike(like), Topic.category.ilike(like))
        )
    if category:
        stmt = stmt.where(Topic.category == category)
    if geography:
        stmt = stmt.where(Topic.geography.ilike(f"%{geography.strip()}%"))
    if status:
        stmt = stmt.where(Topic.status.in_(status))
    elif not include_archived:
        stmt = stmt.where(Topic.status != "archived")
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order: Any = {
        "updated_desc": Topic.updated_at.desc(),
        "title_asc": Topic.title.asc(),
        "created_desc": Topic.created_at.desc(),
    }[sort]
    rows = db.scalars(
        stmt.order_by(order, Topic.id).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return Page(
        items=[_list_item(db, r, p) for r in rows], total=total, page=page, page_size=page_size
    )


@router.get("/categories", response_model=list[str])
def categories(db: DB, p: CurrentUser) -> list[str]:
    if not (p.has(Perm.TOPIC_READ_ALL) or p.has(Perm.TOPIC_READ_ACTIVE)):
        raise forbidden()
    return [
        c
        for c in db.scalars(
            select(Topic.category).where(Topic.category != "").distinct().order_by(Topic.category)
        ).all()
    ]


@router.post("", response_model=TopicDetail, status_code=201)
def create_topic(body: TopicCreate, db: DB, p: CurrentUser, request: Request) -> TopicDetail:
    p.require(Perm.TOPIC_CREATE)
    topic = svc.create_topic(
        db,
        p,
        title=body.title,
        geography=body.geography,
        category=body.category,
        summary=body.summary,
        request=request,
    )
    db.commit()
    db.refresh(topic)
    return _detail(db, topic, p)


@router.get("/{topic_id}", response_model=TopicDetail)
def get_topic(topic_id: UUID, db: DB, p: CurrentUser) -> TopicDetail:
    return _detail(db, _topic(db, p, topic_id), p)


@router.patch("/{topic_id}", response_model=TopicDetail)
def patch_topic(
    topic_id: UUID, body: TopicPatch, db: DB, p: CurrentUser, request: Request
) -> TopicDetail:
    topic = _topic(db, p, topic_id)
    p.require(Perm.TOPIC_EDIT)
    svc.patch_meta(
        db,
        p,
        topic,
        title=body.title,
        geography=body.geography,
        category=body.category,
        request=request,
    )
    db.commit()
    db.refresh(topic)
    return _detail(db, topic, p)


@router.post("/{topic_id}/archive", response_model=TopicDetail)
def archive_topic(topic_id: UUID, db: DB, p: CurrentUser, request: Request) -> TopicDetail:
    topic = _topic(db, p, topic_id)
    p.require(Perm.TOPIC_ARCHIVE)
    svc.archive(db, p, topic, request)
    db.commit()
    db.refresh(topic)
    return _detail(db, topic, p)


@router.post("/{topic_id}/unarchive", response_model=TopicDetail)
def unarchive_topic(topic_id: UUID, db: DB, p: CurrentUser, request: Request) -> TopicDetail:
    topic = _topic(db, p, topic_id)
    p.require(Perm.TOPIC_ARCHIVE)
    svc.unarchive(db, p, topic, request)
    db.commit()
    db.refresh(topic)
    return _detail(db, topic, p)


@router.get("/{topic_id}/versions/{version_id}", response_model=TopicVersionDetail)
def get_version(topic_id: UUID, version_id: UUID, db: DB, p: CurrentUser) -> TopicVersionDetail:
    topic = _topic(db, p, topic_id)
    return _version_detail(db, topic, svc.visible_version(db, p, topic, version_id))


@router.put("/{topic_id}/versions/{version_id}")
def update_version(
    topic_id: UUID,
    version_id: UUID,
    body: TopicVersionUpdate,
    db: DB,
    p: CurrentUser,
    request: Request,
) -> dict:
    topic = _topic(db, p, topic_id)
    p.require(Perm.TOPIC_EDIT)
    v = svc.visible_version(db, p, topic, version_id)
    v, notes = svc.update_draft(
        db, p, topic, v, body.dossier, body.expected_revision, body.change_note, request
    )
    db.commit()
    db.refresh(v)
    return {"version": _version_detail(db, topic, v).model_dump(mode="json"), "notes": notes}


@router.post("/{topic_id}/versions", response_model=TopicVersionDetail, status_code=201)
def create_version(topic_id: UUID, db: DB, p: CurrentUser, request: Request) -> TopicVersionDetail:
    topic = _topic(db, p, topic_id)
    p.require(Perm.TOPIC_EDIT)
    v = svc.new_draft_from_active(db, p, topic, request)
    db.commit()
    db.refresh(v)
    return _version_detail(db, topic, v)


@router.get("/{topic_id}/activation-check", response_model=ActivationCheck)
def activation_check(topic_id: UUID, version_id: UUID, db: DB, p: CurrentUser) -> ActivationCheck:
    p.require(Perm.TOPIC_READ_ALL)
    topic = _topic(db, p, topic_id)
    v = svc.visible_version(db, p, topic, version_id)
    blockers, warnings = svc.activation_check(db, v)
    return ActivationCheck(
        version_id=v.id,
        content_hash=v.content_hash,
        blockers=[Blocker(**b.__dict__) for b in blockers],
        warnings=[Blocker(**w.__dict__) for w in warnings],
    )


@router.post("/{topic_id}/submit", response_model=TopicDetail)
def submit(
    topic_id: UUID, body: TopicVersionIn, db: DB, p: CurrentUser, request: Request
) -> TopicDetail:
    topic = _topic(db, p, topic_id)
    p.require(Perm.TOPIC_EDIT)
    v = svc.visible_version(db, p, topic, body.version_id)
    svc.submit(db, p, topic, v, request)
    db.commit()
    db.refresh(topic)
    return _detail(db, topic, p)


@router.post("/{topic_id}/activate")
def activate(
    topic_id: UUID, body: TopicVersionIn, db: DB, p: CurrentUser, request: Request
) -> dict:
    topic = _topic(db, p, topic_id)
    p.require(Perm.TOPIC_APPROVE)
    v = svc.visible_version(db, p, topic, body.version_id)
    try:
        v = svc.activate(db, p, topic, v, request)
    except ApiError as e:
        db.rollback()
        if e.code == "activation_blocked":
            audit.record(
                db,
                actor_id=p.user.id,
                action="topic.activate_rejected",
                entity_type="topic_version",
                entity_id=body.version_id,
                details={"blockers": [b["code"] for b in e.details or []]},
                request=request,
            )
            db.commit()
        raise
    db.commit()
    return {
        "version_id": str(v.id),
        "label": v.label,
        "state": v.state,
        "content_hash": v.content_hash,
    }


@router.post("/{topic_id}/versions/{version_id}/suspend", response_model=TopicDetail)
def suspend(
    topic_id: UUID,
    version_id: UUID,
    body: TopicSuspendIn,
    db: DB,
    p: CurrentUser,
    request: Request,
) -> TopicDetail:
    topic = _topic(db, p, topic_id)
    p.require(Perm.TOPIC_APPROVE)
    v = svc.visible_version(db, p, topic, version_id)
    svc.suspend(db, p, topic, v, body.reason, request)
    db.commit()
    db.refresh(topic)
    return _detail(db, topic, p)


@router.post("/{topic_id}/claim-flags", response_model=ClaimFlagOut, status_code=201)
def flag_claim(
    topic_id: UUID, body: ClaimFlagIn, db: DB, p: CurrentUser, request: Request
) -> ClaimFlagOut:
    topic = _topic(db, p, topic_id)
    p.require(Perm.TOPIC_APPROVE)
    row = svc.flag_claim(db, p, topic, body.claim_id, body.flag, body.reason, request=request)
    db.commit()
    db.refresh(row)
    return _flag_out(row)


@router.get("/{topic_id}/claims/{claim_id}/history", response_model=list[ClaimHistoryEntry])
def claim_history(
    topic_id: UUID, claim_id: UUID, db: DB, p: CurrentUser
) -> list[ClaimHistoryEntry]:
    """История значения утверждения по версиям и пометкам (§8.5)."""
    topic = _topic(db, p, topic_id)
    out: list[ClaimHistoryEntry] = []
    for v in topic.versions:
        if not p.has(Perm.TOPIC_READ_ALL) and v.state != "active":
            continue
        c = next((c for c in svc.dossier_of(v).claims if c.id == claim_id), None)
        if c is None:
            continue
        out.append(
            ClaimHistoryEntry(
                kind="version",
                at=v.approved_at or v.updated_at,
                version_label=v.label,
                version_state=v.state,
                text=c.text,
                status=c.status,
                valid_until=c.valid_until,
                flag=None,
                reason=None,
                actor=_ref(v.approved_by or v.updated_by),
            )
        )
    flags = db.scalars(
        select(TopicClaimFlag)
        .where(TopicClaimFlag.topic_id == topic.id, TopicClaimFlag.claim_id == claim_id)
        .order_by(TopicClaimFlag.created_at)
    ).all()
    for f in flags:
        out.append(
            ClaimHistoryEntry(
                kind="flag",
                at=f.created_at,
                version_label=None,
                version_state=None,
                text=None,
                status=None,
                valid_until=None,
                flag=f.flag,
                reason=f.reason,
                actor=_ref(f.created_by),
            )
        )
    out.sort(key=lambda e: e.at, reverse=True)
    return out


@router.get("/{topic_id}/history", response_model=list[AuditOut])
def topic_history(topic_id: UUID, db: DB, p: CurrentUser) -> list[AuditOut]:
    p.require(Perm.TOPIC_READ_ALL)
    topic = _topic(db, p, topic_id)
    ids = [str(topic.id)] + [str(v.id) for v in topic.versions]
    rows = db.scalars(
        select(AuditEvent)
        .where(AuditEvent.entity_id.in_(ids))
        .order_by(AuditEvent.occurred_at.desc())
        .limit(200)
    ).all()
    return [audit_out(e) for e in rows]
