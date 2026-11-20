"""База знаний (/knowledge) и реестр источников (/sources)."""

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, File, Form, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app.deps import DB, CurrentUser
from app.errors import ApiError, not_found
from app.knowledge import storage
from app.models import KnowledgeItem, KnowledgeItemTopic, Source, SourceFetch, Topic
from app.rbac import Perm
from app.schemas import Page, UserRef
from app.services import knowledge as svc

router = APIRouter(tags=["knowledge"])

Layer = Literal["global", "topic"]


class TopicRef(BaseModel):
    id: UUID
    title: str


class SourceRef(BaseModel):
    id: UUID
    name: str
    url: str | None


class KnowledgeItemOut(BaseModel):
    id: UUID
    title: str
    kind: str
    layer: str
    format: str
    mime: str
    filename: str | None
    size_bytes: int | None
    url: str | None
    final_url: str | None
    source: SourceRef | None
    topics: list[TopicRef]
    text_chars: int
    extraction_status: str
    extraction_note: str
    pages_total: int | None
    pages_with_text: int | None
    published_at: date | None
    has_file: bool
    created_by: UserRef | None
    created_at: datetime
    archived_at: datetime | None


class KnowledgeItemDetail(KnowledgeItemOut):
    text: str


class SearchHit(BaseModel):
    item: KnowledgeItemOut
    rank: float
    excerpt: str


class UrlIn(BaseModel):
    url: str = Field(min_length=8, max_length=2000)
    title: str = Field(default="", max_length=500)
    layer: Layer = "global"
    topic_ids: list[UUID] = Field(default_factory=list, max_length=50)
    source_id: UUID | None = None
    published_at: date | None = None


class TextIn(BaseModel):
    title: str = Field(min_length=3, max_length=500)
    text: str = Field(min_length=10, max_length=200_000)
    layer: Layer = "global"
    topic_ids: list[UUID] = Field(default_factory=list, max_length=50)
    source_id: UUID | None = None
    published_at: date | None = None


class ItemPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    layer: Layer | None = None
    topic_ids: list[UUID] | None = Field(default=None, max_length=50)
    source_id: UUID | None = None
    published_at: date | None = None


def _ref(u) -> UserRef | None:  # type: ignore[no-untyped-def]
    return UserRef(id=u.id, display_name=u.display_name) if u else None


def _item_out(db: DB, it: KnowledgeItem) -> KnowledgeItemOut:
    ids = [link.topic_id for link in it.topic_links]
    topics = (
        [
            TopicRef(id=t.id, title=t.title)
            for t in db.scalars(select(Topic).where(Topic.id.in_(ids)))
        ]
        if ids
        else []
    )
    return KnowledgeItemOut(
        id=it.id,
        title=it.title,
        kind=it.kind,
        layer=it.layer,
        format=it.format,
        mime=it.mime,
        filename=it.filename,
        size_bytes=it.size_bytes,
        url=it.url,
        final_url=it.final_url,
        source=SourceRef(id=it.source.id, name=it.source.name, url=it.source.url)
        if it.source
        else None,
        topics=topics,
        text_chars=it.text_chars,
        extraction_status=it.extraction_status,
        extraction_note=it.extraction_note,
        pages_total=it.pages_total,
        pages_with_text=it.pages_with_text,
        published_at=it.published_at,
        has_file=it.file_id is not None,
        created_by=_ref(it.created_by),
        created_at=it.created_at,
        archived_at=it.archived_at,
    )


def _detail(db: DB, it: KnowledgeItem) -> KnowledgeItemDetail:
    return KnowledgeItemDetail(**_item_out(db, it).model_dump(), text=it.text)


@router.get("/knowledge", response_model=Page[KnowledgeItemOut])
def list_items(
    db: DB,
    p: CurrentUser,
    q: str | None = Query(default=None, max_length=200),
    layer: Layer | None = None,
    topic_id: UUID | None = None,
    source_id: UUID | None = None,
    status: str | None = None,
    include_archived: bool = False,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> Page[KnowledgeItemOut]:
    p.require(Perm.KNOWLEDGE_READ)
    stmt = select(KnowledgeItem)
    if not include_archived:
        stmt = stmt.where(KnowledgeItem.archived_at.is_(None))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                KnowledgeItem.title.ilike(like),
                KnowledgeItem.filename.ilike(like),
                KnowledgeItem.url.ilike(like),
            )
        )
    if layer:
        stmt = stmt.where(KnowledgeItem.layer == layer)
    if topic_id:
        stmt = stmt.where(
            KnowledgeItem.id.in_(
                select(KnowledgeItemTopic.item_id).where(KnowledgeItemTopic.topic_id == topic_id)
            )
        )
    if source_id:
        stmt = stmt.where(KnowledgeItem.source_id == source_id)
    if status:
        stmt = stmt.where(KnowledgeItem.extraction_status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(KnowledgeItem.created_at.desc(), KnowledgeItem.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return Page(items=[_item_out(db, r) for r in rows], total=total, page=page, page_size=page_size)


@router.get("/knowledge/search", response_model=list[SearchHit])
def search(
    db: DB,
    p: CurrentUser,
    q: str = Query(min_length=2, max_length=300),
    topic_id: UUID | None = None,
    layer: Layer | None = None,
    limit: int = Query(default=20, ge=1, le=50),
) -> list[SearchHit]:
    p.require(Perm.KNOWLEDGE_READ)
    return [
        SearchHit(item=_item_out(db, h.item), rank=h.rank, excerpt=h.excerpt)
        for h in svc.search(db, q, topic_id=topic_id, layer=layer, limit=limit)
    ]


@router.post("/knowledge/files", response_model=KnowledgeItemDetail, status_code=201)
async def upload_file(
    request: Request,
    db: DB,
    p: CurrentUser,
    file: Annotated[UploadFile, File()],
    title: Annotated[str, Form(max_length=500)] = "",
    layer: Annotated[Layer, Form()] = "global",
    topic_ids: Annotated[list[UUID] | None, Form()] = None,
    source_id: Annotated[UUID | None, Form()] = None,
    published_at: Annotated[date | None, Form()] = None,
) -> KnowledgeItemDetail:
    p.require(Perm.KNOWLEDGE_ADD)
    data = await file.read(storage.MAX_FILE_BYTES + 1)
    item = svc.add_file(
        db,
        p,
        data=data,
        filename=(file.filename or "file").replace("\\", "/").rsplit("/", 1)[-1],
        title=title,
        layer=layer,
        topic_ids=topic_ids or [],
        source_id=source_id,
        published_at=published_at,
        request=request,
    )
    db.commit()
    db.refresh(item)
    return _detail(db, item)


@router.post("/knowledge/urls", response_model=KnowledgeItemDetail, status_code=201)
def add_url(body: UrlIn, request: Request, db: DB, p: CurrentUser) -> KnowledgeItemDetail:
    p.require(Perm.KNOWLEDGE_ADD)
    item = svc.add_url(
        db,
        p,
        url=body.url,
        title=body.title,
        layer=body.layer,
        topic_ids=body.topic_ids,
        source_id=body.source_id,
        published_at=body.published_at,
        request=request,
    )
    db.commit()
    db.refresh(item)
    return _detail(db, item)


@router.post("/knowledge/texts", response_model=KnowledgeItemDetail, status_code=201)
def add_text(body: TextIn, request: Request, db: DB, p: CurrentUser) -> KnowledgeItemDetail:
    p.require(Perm.KNOWLEDGE_ADD)
    item = svc.add_text(
        db,
        p,
        title=body.title,
        body=body.text,
        layer=body.layer,
        topic_ids=body.topic_ids,
        source_id=body.source_id,
        published_at=body.published_at,
        request=request,
    )
    db.commit()
    db.refresh(item)
    return _detail(db, item)


@router.get("/knowledge/{item_id}", response_model=KnowledgeItemDetail)
def get_item(item_id: UUID, db: DB, p: CurrentUser) -> KnowledgeItemDetail:
    return _detail(db, svc.visible_item(db, p, item_id))


@router.get("/knowledge/{item_id}/file")
def download(item_id: UUID, db: DB, p: CurrentUser) -> Response:
    """Исходный файл — только как вложение (не открывается в контексте сайта)."""
    item = svc.visible_item(db, p, item_id)
    f = storage.get(db, item.file_id) if item.file_id else None
    if f is None:
        raise not_found("Файл")
    name = item.filename or f"{item.id}.{item.format}"
    return Response(
        content=f.data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{_quote(name)}",
            "X-Content-Type-Options": "nosniff",
        },
    )


def _quote(s: str) -> str:
    from urllib.parse import quote

    return quote(s, safe="")


@router.patch("/knowledge/{item_id}", response_model=KnowledgeItemDetail)
def patch_item(
    item_id: UUID, body: ItemPatch, request: Request, db: DB, p: CurrentUser
) -> KnowledgeItemDetail:
    item = svc.visible_item(db, p, item_id)
    svc.update_meta(db, p, item, body.model_dump(exclude_unset=True), request)
    db.commit()
    db.refresh(item)
    return _detail(db, item)


@router.post("/knowledge/{item_id}/archive", response_model=KnowledgeItemOut)
def archive_item(item_id: UUID, request: Request, db: DB, p: CurrentUser) -> KnowledgeItemOut:
    item = svc.visible_item(db, p, item_id)
    svc.set_archived(db, p, item, True, request)
    db.commit()
    db.refresh(item)
    return _item_out(db, item)


@router.post("/knowledge/{item_id}/unarchive", response_model=KnowledgeItemOut)
def unarchive_item(item_id: UUID, request: Request, db: DB, p: CurrentUser) -> KnowledgeItemOut:
    item = svc.visible_item(db, p, item_id)
    svc.set_archived(db, p, item, False, request)
    db.commit()
    db.refresh(item)
    return _item_out(db, item)


# ---------- реестр источников ----------

SourceKind = Literal["official", "media", "rss", "api", "community", "file", "other"]


class SourceIn(BaseModel):
    name: str = Field(min_length=2, max_length=300)
    url: str | None = Field(default=None, max_length=2000)
    kind: SourceKind = "other"
    geography: str = Field(default="", max_length=300)
    topics: str = Field(default="", max_length=1000)
    access_method: Literal["manual", "web", "rss", "api"] = "manual"
    access_notes: str = Field(default="", max_length=4000)
    priority: int = Field(default=3, ge=1, le=5)
    check_interval: Literal["none", "4h", "daily", "weekly"] = "none"
    status: Literal["active", "disabled"] = "active"


class SourcePatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=300)
    url: str | None = Field(default=None, max_length=2000)
    kind: SourceKind | None = None
    geography: str | None = Field(default=None, max_length=300)
    topics: str | None = Field(default=None, max_length=1000)
    access_method: Literal["manual", "web", "rss", "api"] | None = None
    access_notes: str | None = Field(default=None, max_length=4000)
    priority: int | None = Field(default=None, ge=1, le=5)
    check_interval: Literal["none", "4h", "daily", "weekly"] | None = None
    status: Literal["active", "disabled"] | None = None


class SourceOut(BaseModel):
    id: UUID
    name: str
    url: str | None
    kind: str
    geography: str
    topics: str
    access_method: str
    access_notes: str
    priority: int
    check_interval: str
    status: str
    last_checked_at: datetime | None
    last_ok_at: datetime | None
    last_error: str | None
    items_count: int
    created_by: UserRef | None
    created_at: datetime
    updated_at: datetime


class SourceFetchOut(BaseModel):
    id: UUID
    purpose: str
    ok: bool
    http_status: int | None
    final_url: str | None
    bytes: int | None
    duration_ms: int | None
    error: str | None
    knowledge_item_id: UUID | None
    created_at: datetime


def _src_out(db: DB, s: Source) -> SourceOut:
    n = db.scalar(
        select(func.count()).where(
            KnowledgeItem.source_id == s.id, KnowledgeItem.archived_at.is_(None)
        )
    )
    return SourceOut(
        id=s.id,
        name=s.name,
        url=s.url,
        kind=s.kind,
        geography=s.geography,
        topics=s.topics,
        access_method=s.access_method,
        access_notes=s.access_notes,
        priority=s.priority,
        check_interval=s.check_interval,
        status=s.status,
        last_checked_at=s.last_checked_at,
        last_ok_at=s.last_ok_at,
        last_error=s.last_error,
        items_count=n or 0,
        created_by=_ref(s.created_by),
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


def _source(db: DB, p: CurrentUser, source_id: UUID) -> Source:
    p.require(Perm.SOURCE_READ)
    s = db.get(Source, source_id)
    if s is None:
        raise not_found("Источник")
    return s


@router.get("/sources", response_model=list[SourceOut])
def list_sources(
    db: DB,
    p: CurrentUser,
    q: str | None = Query(default=None, max_length=200),
    kind: SourceKind | None = None,
    status: Literal["active", "disabled"] | None = None,
) -> list[SourceOut]:
    p.require(Perm.SOURCE_READ)
    stmt = select(Source)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Source.name.ilike(like),
                Source.url.ilike(like),
                Source.geography.ilike(like),
                Source.topics.ilike(like),
            )
        )
    if kind:
        stmt = stmt.where(Source.kind == kind)
    if status:
        stmt = stmt.where(Source.status == status)
    rows = db.scalars(stmt.order_by(Source.priority.desc(), Source.name)).all()
    return [_src_out(db, s) for s in rows]


@router.post("/sources", response_model=SourceOut, status_code=201)
def create_source(body: SourceIn, request: Request, db: DB, p: CurrentUser) -> SourceOut:
    p.require(Perm.SOURCE_MANAGE)
    data = body.model_dump()
    data["url"] = (data["url"] or "").strip() or None
    s = svc.create_source(db, p, data, request)
    db.commit()
    db.refresh(s)
    return _src_out(db, s)


@router.get("/sources/{source_id}", response_model=SourceOut)
def get_source(source_id: UUID, db: DB, p: CurrentUser) -> SourceOut:
    return _src_out(db, _source(db, p, source_id))


@router.patch("/sources/{source_id}", response_model=SourceOut)
def patch_source(
    source_id: UUID, body: SourcePatch, request: Request, db: DB, p: CurrentUser
) -> SourceOut:
    s = _source(db, p, source_id)
    p.require(Perm.SOURCE_MANAGE)
    data = body.model_dump(exclude_unset=True)
    if "url" in data:
        data["url"] = (data["url"] or "").strip() or None
    svc.update_source(db, p, s, data, request)
    db.commit()
    db.refresh(s)
    return _src_out(db, s)


@router.post("/sources/{source_id}/check", response_model=SourceFetchOut)
def check_source(source_id: UUID, db: DB, p: CurrentUser) -> SourceFetchOut:
    s = _source(db, p, source_id)
    p.require(Perm.SOURCE_MANAGE)
    if s.status != "active":
        raise ApiError(409, "source_disabled", "Источник отключён")
    row = svc.check_source(db, p, s)
    db.commit()
    db.refresh(row)
    return SourceFetchOut.model_validate(row, from_attributes=True)


@router.get("/sources/{source_id}/fetches", response_model=list[SourceFetchOut])
def source_fetches(source_id: UUID, db: DB, p: CurrentUser) -> list[SourceFetchOut]:
    s = _source(db, p, source_id)
    rows = db.scalars(
        select(SourceFetch)
        .where(SourceFetch.source_id == s.id)
        .order_by(SourceFetch.created_at.desc())
        .limit(50)
    ).all()
    return [SourceFetchOut.model_validate(r, from_attributes=True) for r in rows]
