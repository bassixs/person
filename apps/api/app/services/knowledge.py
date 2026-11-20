"""База знаний и реестр источников (PROJECT_CONTEXT §9; ТЗ §3).

Материал — не факт: загрузка, извлечение и поиск не меняют утверждения тем. Факты появляются
только в досье темы через редактора (services/topics).
"""

import hashlib
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from fastapi import Request
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app import audit
from app.deps import Principal
from app.errors import ApiError, forbidden, not_found
from app.knowledge import storage
from app.knowledge.extract import Extracted, UnsupportedFormat, extract
from app.knowledge.fetch import FetchBlocked, FetchFailed, check_url, fetch
from app.models import KnowledgeItem, KnowledgeItemTopic, Source, SourceFetch, Topic
from app.rbac import Perm

# ---------- материалы ----------


def visible_item(db: Session, p: Principal, item_id: UUID) -> KnowledgeItem:
    p.require(Perm.KNOWLEDGE_READ)
    item = db.get(KnowledgeItem, item_id)
    if item is None:
        raise not_found("Материал")
    return item


def _set_links(db: Session, item: KnowledgeItem, layer: str, topic_ids: list[UUID]) -> None:
    ids = list(dict.fromkeys(topic_ids))
    if layer == "topic" and not ids:
        raise ApiError(
            422, "topic_required", "Материал темы должен быть связан хотя бы с одной темой"
        )
    if ids:
        found = set(db.scalars(select(Topic.id).where(Topic.id.in_(ids))).all())
        missing = [str(i) for i in ids if i not in found]
        if missing:
            raise ApiError(422, "topic_not_found", "Тема не найдена", missing)
    item.layer = layer
    item.topic_links = [KnowledgeItemTopic(topic_id=i) for i in ids]


def _check_source(db: Session, source_id: UUID | None) -> Source | None:
    if source_id is None:
        return None
    src = db.get(Source, source_id)
    if src is None:
        raise ApiError(422, "source_not_found", "Источник не найден в реестре")
    return src


def _duplicate(db: Session, sha: str) -> KnowledgeItem | None:
    return db.scalar(
        select(KnowledgeItem).where(
            KnowledgeItem.sha256 == sha, KnowledgeItem.archived_at.is_(None)
        )
    )


def _raise_duplicate(dup: KnowledgeItem) -> None:
    raise ApiError(
        409,
        "duplicate",
        f"Такой материал уже есть в базе: «{dup.title}»",
        {"existing_id": str(dup.id)},
    )


def _create(
    db: Session,
    p: Principal,
    *,
    kind: str,
    title: str,
    ex: Extracted,
    sha: str,
    layer: str,
    topic_ids: list[UUID],
    source: Source | None,
    published_at: date | None,
    filename: str | None = None,
    size: int | None = None,
    file_id: UUID | None = None,
    url: str | None = None,
    final_url: str | None = None,
    request: Request | None = None,
) -> KnowledgeItem:
    item = KnowledgeItem(
        title=title.strip()[:500] or "Без названия",
        kind=kind,
        format=ex.kind,
        mime=ex.mime,
        filename=filename,
        size_bytes=size,
        sha256=sha,
        file_id=file_id,
        url=url,
        final_url=final_url,
        source_id=source.id if source else None,
        text=ex.text,
        text_chars=len(ex.text),
        extraction_status=ex.status,
        extraction_note=ex.note,
        pages_total=ex.pages_total,
        pages_with_text=ex.pages_with_text,
        published_at=published_at,
        created_by_id=p.user.id,
    )
    _set_links(db, item, layer, topic_ids)
    db.add(item)
    db.flush()
    audit.record(
        db,
        actor_id=p.user.id,
        action="knowledge.add",
        entity_type="knowledge_item",
        entity_id=item.id,
        details={
            "kind": kind,
            "format": ex.kind,
            "extraction": ex.status,
            "topics": [str(t) for t in topic_ids],
        },
        request=request,
    )
    return item


def add_file(
    db: Session,
    p: Principal,
    *,
    data: bytes,
    filename: str,
    title: str,
    layer: str,
    topic_ids: list[UUID],
    source_id: UUID | None,
    published_at: date | None,
    request: Request | None = None,
) -> KnowledgeItem:
    if not data:
        raise ApiError(422, "empty_file", "Файл пустой")
    if len(data) > storage.MAX_FILE_BYTES:
        raise ApiError(413, "file_too_large", "Файл больше 20 МБ")
    source = _check_source(db, source_id)
    sha = hashlib.sha256(data).hexdigest()
    dup = _duplicate(db, sha)
    if dup is not None:
        _raise_duplicate(dup)
    try:
        ex = extract(data, filename)
    except UnsupportedFormat as e:
        raise ApiError(415, "unsupported_format", str(e)) from e
    stored = storage.put(db, data, ex.mime)
    return _create(
        db,
        p,
        kind="file",
        title=title or filename,
        ex=ex,
        sha=sha,
        layer=layer,
        topic_ids=topic_ids,
        source=source,
        published_at=published_at,
        filename=filename[:500],
        size=len(data),
        file_id=stored.id,
        request=request,
    )


def _log_fetch(
    db: Session,
    p: Principal,
    source: Source,
    purpose: str,
    *,
    ok: bool,
    status: int | None = None,
    final_url: str | None = None,
    size: int | None = None,
    duration_ms: int | None = None,
    error: str | None = None,
    item_id: UUID | None = None,
) -> SourceFetch:
    now = datetime.now(UTC)
    row = SourceFetch(
        source_id=source.id,
        purpose=purpose,
        ok=ok,
        http_status=status,
        final_url=final_url,
        bytes=size,
        duration_ms=duration_ms,
        error=error,
        knowledge_item_id=item_id,
        actor_id=p.user.id,
    )
    db.add(row)
    source.last_checked_at = now
    if ok:
        source.last_ok_at = now
        source.last_error = None
    else:
        source.last_error = error
    return row


def add_url(
    db: Session,
    p: Principal,
    *,
    url: str,
    title: str,
    layer: str,
    topic_ids: list[UUID],
    source_id: UUID | None,
    published_at: date | None,
    request: Request | None = None,
) -> KnowledgeItem:
    source = _check_source(db, source_id)
    try:
        res = fetch(url)
    except FetchBlocked as e:
        raise ApiError(422, "url_blocked", str(e)) from e
    except FetchFailed as e:
        if source is not None:
            _log_fetch(db, p, source, "import", ok=False, error=str(e))
            db.commit()
        raise ApiError(502, "fetch_failed", f"Не удалось получить материал: {e}") from e
    if not res.body:
        raise ApiError(502, "fetch_failed", "Источник вернул пустой ответ")
    sha = hashlib.sha256(res.body).hexdigest()
    dup = _duplicate(db, sha)
    if dup is not None:
        _raise_duplicate(dup)
    name = res.final_url.rsplit("/", 1)[-1] or "page"
    try:
        ex = extract(res.body, name, res.content_type)
    except UnsupportedFormat as e:
        raise ApiError(415, "unsupported_format", f"По ссылке: {e}") from e
    if res.truncated:
        ex.status = "partial" if ex.text else ex.status
        ex.note = f"{ex.note}. Ответ обрезан по лимиту 10 МБ."
    stored = storage.put(db, res.body, ex.mime)
    item = _create(
        db,
        p,
        kind="url",
        title=title or ex.title or res.final_url,
        ex=ex,
        sha=sha,
        layer=layer,
        topic_ids=topic_ids,
        source=source,
        published_at=published_at,
        filename=None,
        size=len(res.body),
        file_id=stored.id,
        url=url.strip(),
        final_url=res.final_url,
        request=request,
    )
    if source is not None:
        _log_fetch(
            db,
            p,
            source,
            "import",
            ok=True,
            status=res.status,
            final_url=res.final_url,
            size=len(res.body),
            duration_ms=res.duration_ms,
            item_id=item.id,
        )
    return item


def add_text(
    db: Session,
    p: Principal,
    *,
    title: str,
    body: str,
    layer: str,
    topic_ids: list[UUID],
    source_id: UUID | None,
    published_at: date | None,
    request: Request | None = None,
) -> KnowledgeItem:
    data = body.encode("utf-8")
    sha = hashlib.sha256(data).hexdigest()
    dup = _duplicate(db, sha)
    if dup is not None:
        _raise_duplicate(dup)
    ex = extract(data, "note.txt")
    return _create(
        db,
        p,
        kind="text",
        title=title,
        ex=ex,
        sha=sha,
        layer=layer,
        topic_ids=topic_ids,
        source=_check_source(db, source_id),
        published_at=published_at,
        request=request,
    )


def update_meta(
    db: Session,
    p: Principal,
    item: KnowledgeItem,
    changes: dict[str, Any],
    request: Request | None = None,
) -> KnowledgeItem:
    _require_owner_or_manager(p, item)
    diff: dict[str, Any] = {}
    if "title" in changes and changes["title"] is not None:
        item.title = changes["title"].strip()[:500]
        diff["title"] = item.title
    if "published_at" in changes:
        item.published_at = changes["published_at"]
        diff["published_at"] = str(item.published_at) if item.published_at else None
    if "source_id" in changes:
        item.source_id = (
            src.id
            if changes["source_id"] and (src := _check_source(db, changes["source_id"]))
            else None
        )
        diff["source_id"] = str(item.source_id) if item.source_id else None
    if changes.get("layer") is not None or changes.get("topic_ids") is not None:
        layer = changes.get("layer") or item.layer
        ids = changes.get("topic_ids")
        if ids is None:
            ids = [link.topic_id for link in item.topic_links]
        _set_links(db, item, layer, ids)
        diff["layer"] = layer
        diff["topics"] = [str(i) for i in ids]
    item.updated_at = datetime.now(UTC)
    audit.record(
        db,
        actor_id=p.user.id,
        action="knowledge.update",
        entity_type="knowledge_item",
        entity_id=item.id,
        details=diff,
        request=request,
    )
    return item


def _require_owner_or_manager(p: Principal, item: KnowledgeItem) -> None:
    p.require(Perm.KNOWLEDGE_ADD)
    if not p.has(Perm.KNOWLEDGE_MANAGE) and item.created_by_id != p.user.id:
        raise forbidden("Изменять чужие материалы может только редактор")


def set_archived(
    db: Session, p: Principal, item: KnowledgeItem, archived: bool, request: Request | None
) -> KnowledgeItem:
    _require_owner_or_manager(p, item)
    if archived and item.archived_at is None:
        item.archived_at = datetime.now(UTC)
    elif not archived and item.archived_at is not None:
        dup = _duplicate(db, item.sha256)
        if dup is not None and dup.id != item.id:
            _raise_duplicate(dup)
        item.archived_at = None
    audit.record(
        db,
        actor_id=p.user.id,
        action="knowledge.archive" if archived else "knowledge.unarchive",
        entity_type="knowledge_item",
        entity_id=item.id,
        request=request,
    )
    return item


@dataclass
class Hit:
    item: KnowledgeItem
    rank: float
    excerpt: str


def search(
    db: Session,
    q: str,
    *,
    topic_id: UUID | None = None,
    layer: str | None = None,
    limit: int = 20,
) -> list[Hit]:
    """Полнотекстовый поиск (русская морфология). Каждый результат — с цитатой из материала."""
    query = func.websearch_to_tsquery("russian", q)
    stmt = (
        select(
            KnowledgeItem,
            func.ts_rank_cd(KnowledgeItem.search_vector, query).label("rank"),
            func.ts_headline(
                "russian",
                func.left(KnowledgeItem.text, 300000),
                query,
                "StartSel=⟦, StopSel=⟧, MaxFragments=2, MaxWords=35, MinWords=12, "
                'FragmentDelimiter=" … "',
            ).label("excerpt"),
        )
        .where(KnowledgeItem.search_vector.op("@@")(query), KnowledgeItem.archived_at.is_(None))
        .order_by(text("rank DESC"), KnowledgeItem.created_at.desc())
        .limit(limit)
    )
    if topic_id is not None:
        stmt = stmt.where(
            KnowledgeItem.id.in_(
                select(KnowledgeItemTopic.item_id).where(KnowledgeItemTopic.topic_id == topic_id)
            )
        )
    if layer:
        stmt = stmt.where(KnowledgeItem.layer == layer)
    return [Hit(item=r[0], rank=float(r[1]), excerpt=r[2] or "") for r in db.execute(stmt).all()]


# ---------- реестр источников ----------


def create_source(
    db: Session, p: Principal, data: dict[str, Any], request: Request | None
) -> Source:
    if data.get("url"):
        try:
            check_url(data["url"])
        except FetchBlocked as e:
            raise ApiError(422, "url_blocked", str(e)) from e
    src = Source(**data, created_by_id=p.user.id)
    db.add(src)
    db.flush()
    audit.record(
        db,
        actor_id=p.user.id,
        action="source.create",
        entity_type="source",
        entity_id=src.id,
        details={"name": src.name, "kind": src.kind},
        request=request,
    )
    return src


def update_source(
    db: Session, p: Principal, src: Source, data: dict[str, Any], request: Request | None
) -> Source:
    if data.get("url"):
        try:
            check_url(data["url"])
        except FetchBlocked as e:
            raise ApiError(422, "url_blocked", str(e)) from e
    diff = {}
    for k, v in data.items():
        if getattr(src, k) != v:
            diff[k] = v
            setattr(src, k, v)
    if diff:
        audit.record(
            db,
            actor_id=p.user.id,
            action="source.update",
            entity_type="source",
            entity_id=src.id,
            details=diff,
            request=request,
        )
    return src


def check_source(db: Session, p: Principal, src: Source) -> SourceFetch:
    """Проверка соединения реальным запросом.

    Недоступность фиксируется как ошибка получения, а не как «нет новостей».
    """
    if not src.url:
        raise ApiError(422, "no_url", "У источника нет ссылки — проверять нечего")
    try:
        res = fetch(src.url, max_bytes=256 * 1024, timeout=10.0)
    except FetchBlocked as e:
        return _log_fetch(db, p, src, "check", ok=False, error=str(e))
    except FetchFailed as e:
        return _log_fetch(db, p, src, "check", ok=False, error=str(e))
    return _log_fetch(
        db,
        p,
        src,
        "check",
        ok=True,
        status=res.status,
        final_url=res.final_url,
        size=len(res.body),
        duration_ms=res.duration_ms,
    )
