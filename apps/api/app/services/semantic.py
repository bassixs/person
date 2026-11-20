"""Смысловой поиск и отбор контекста (E-037).

- Индексация в фоне: текст материала режется на куски, каждый кусок получает вектор смысла.
- Поиск гибридный: смысловой (pgvector, косинусная близость) + полнотекстовый, объединение
  по формуле RRF. Без эмбеддингов — только полнотекстовый, интерфейс об этом знает.
- Для карточки понимания: если материалов больше бюджета, ИИ получает самые подходящие теме
  куски, а не начало каждого файла.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID

import httpx
from sqlalchemy import Float, bindparam, delete, select
from sqlalchemy.orm import Session

from app import jobs
from app.ai import embeddings
from app.config import get_settings
from app.db import session_factory
from app.errors import ApiError
from app.knowledge.chunks import split
from app.models import VECTOR_DIM, KnowledgeChunk, KnowledgeItem, KnowledgeItemTopic, Vector
from app.services import knowledge as ksvc

log = logging.getLogger("lichnosti.semantic")
RRF_K = 60


# ---------- индексация ----------


def schedule_index(item: KnowledgeItem) -> None:
    """Ставит материал в очередь индексации (вызывать после commit)."""
    if embeddings.embeddings_configured() and item.text:
        jobs.submit(index_item, item.id)


def mark_pending(item: KnowledgeItem) -> None:
    if not embeddings.embeddings_configured():
        item.index_status = "none"
    elif not item.text:
        item.index_status = "skipped"
        item.index_error = "Нет текста — индексировать нечего"
    else:
        item.index_status = "pending"
        item.index_error = None


def index_item(item_id: UUID) -> None:
    with session_factory()() as db:
        item = db.get(KnowledgeItem, item_id)
        if item is None:
            return
        if not item.text:
            item.index_status, item.index_error = "skipped", "Нет текста — индексировать нечего"
            db.commit()
            return
        if embeddings.dimensions() != VECTOR_DIM:
            item.index_status = "failed"
            item.index_error = f"EMBEDDING_DIMENSIONS должен быть {VECTOR_DIM}"
            db.commit()
            return
        parts = split(item.text)
        try:
            # Название в каждом куске — контекст для модели («о чём документ»).
            vecs = embeddings.embed([f"{item.title}\n{c.text}" for c in parts])
        except (ApiError, httpx.HTTPError, KeyError, ValueError) as e:
            item.index_status = "failed"
            item.index_error = getattr(e, "message", None) or f"Ошибка: {type(e).__name__}"
            db.commit()
            return
        db.execute(delete(KnowledgeChunk).where(KnowledgeChunk.item_id == item.id))
        model = embeddings.model_name()
        for c, v in zip(parts, vecs, strict=True):
            db.add(
                KnowledgeChunk(
                    item_id=item.id,
                    position=c.position,
                    text=c.text,
                    char_start=c.char_start,
                    page=c.page,
                    embedding=v,
                    model=model,
                )
            )
        item.index_status = "ok"
        item.index_error = None
        item.index_model = model
        item.indexed_at = datetime.now(UTC)
        item.chunks_count = len(parts)
        db.commit()


def reindex(db: Session, only_missing: bool = True) -> int:
    """Переиндексация (например, после подключения ключа или смены модели)."""
    if not embeddings.embeddings_configured():
        raise ApiError(503, "embeddings_not_configured", "Смысловой поиск не подключён")
    stmt = select(KnowledgeItem).where(
        KnowledgeItem.archived_at.is_(None), KnowledgeItem.text_chars > 0
    )
    if only_missing:
        stmt = stmt.where(
            (KnowledgeItem.index_status.in_(("none", "failed")))
            | (KnowledgeItem.index_model != embeddings.model_name())
        )
    items = list(db.scalars(stmt).all())
    for it in items:
        it.index_status = "pending"
        it.index_error = None
    db.commit()
    for it in items:
        jobs.submit(index_item, it.id)
    return len(items)


# ---------- поиск ----------


@dataclass
class ChunkHit:
    item_id: UUID
    text: str
    page: int | None
    similarity: float


def semantic_chunks(
    db: Session,
    q: str,
    *,
    topic_id: UUID | None = None,
    layer: str | None = None,
    item_ids: list[UUID] | None = None,
    limit: int = 40,
) -> list[ChunkHit]:
    qv = embeddings.embed([q])[0]
    dist = KnowledgeChunk.embedding.op("<=>", return_type=Float())(
        bindparam("qv", qv, type_=Vector(VECTOR_DIM))
    )
    stmt = (
        select(KnowledgeChunk, dist.label("dist"))
        .join(KnowledgeItem, KnowledgeItem.id == KnowledgeChunk.item_id)
        .where(KnowledgeItem.archived_at.is_(None))
        .order_by(dist)
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
    if item_ids is not None:
        stmt = stmt.where(KnowledgeItem.id.in_(item_ids))
    return [
        ChunkHit(item_id=c.item_id, text=c.text, page=c.page, similarity=1 - float(d))
        for c, d in db.execute(stmt).all()
    ]


@dataclass
class HybridHit:
    item: KnowledgeItem
    score: float
    excerpt: str
    match: str  # semantic | text | both
    page: int | None = None
    similarity: float | None = None
    extra: dict = field(default_factory=dict)


def _snippet(text: str, limit: int = 420) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    return cut[: cut.rfind(" ")] + " …" if " " in cut else cut + " …"


def hybrid_search(
    db: Session,
    q: str,
    *,
    topic_id: UUID | None = None,
    layer: str | None = None,
    limit: int = 20,
    semantic: bool = True,
) -> tuple[list[HybridHit], bool]:
    """Возвращает (результаты, использовался ли смысловой поиск)."""
    text_hits = ksvc.search(db, q, topic_id=topic_id, layer=layer, limit=40)
    use_sem = semantic and embeddings.embeddings_configured()
    sem: dict[UUID, ChunkHit] = {}
    if use_sem:
        try:
            floor = get_settings().semantic_min_similarity
            for ch in semantic_chunks(db, q, topic_id=topic_id, layer=layer):
                if ch.similarity < floor:
                    break  # дальше только менее похожие
                if ch.item_id not in sem:  # лучший кусок материала
                    sem[ch.item_id] = ch
        except (ApiError, httpx.HTTPError) as e:
            log.warning("Смысловой поиск недоступен: %s", e)
            use_sem = False
    scores: dict[UUID, float] = {}
    for rank, th0 in enumerate(text_hits):
        scores[th0.item.id] = scores.get(th0.item.id, 0) + 1 / (RRF_K + rank + 1)
    for rank, iid in enumerate(sem):
        scores[iid] = scores.get(iid, 0) + 1 / (RRF_K + rank + 1)
    by_text = {h.item.id: h for h in text_hits}
    items = {
        i.id: i
        for i in db.scalars(select(KnowledgeItem).where(KnowledgeItem.id.in_(list(scores)))).all()
    }
    out: list[HybridHit] = []
    for iid, score in sorted(scores.items(), key=lambda kv: -kv[1])[:limit]:
        th, sh = by_text.get(iid), sem.get(iid)
        match = "both" if th and sh else ("text" if th else "semantic")
        excerpt = th.excerpt if th and th.excerpt else (_snippet(sh.text) if sh else "")
        out.append(
            HybridHit(
                item=items[iid],
                score=score,
                excerpt=excerpt,
                match=match,
                page=sh.page if sh else None,
                similarity=round(sh.similarity, 3) if sh else None,
            )
        )
    return out, use_sem


# ---------- отбор контекста для ИИ ----------


def select_context(
    db: Session, items: list[KnowledgeItem], query: str, budget: int
) -> tuple[dict[UUID, str], set[UUID]]:
    """Текст для каждого материала в пределах бюджета.

    Если всё помещается — целиком. Иначе, при наличии смыслового индекса, — самые подходящие
    запросу куски (у каждого материала не меньше первого куска). Возвращает тексты и множество
    материалов, переданных фрагментами.
    """
    total = sum(len(i.text) for i in items)
    if total <= budget or not embeddings.embeddings_configured():
        return {i.id: i.text for i in items}, set()
    indexed = [i for i in items if i.index_status == "ok"]
    if not indexed:
        return {i.id: i.text for i in items}, set()
    try:
        hits = semantic_chunks(db, query, item_ids=[i.id for i in indexed], limit=200)
    except (ApiError, httpx.HTTPError):
        return {i.id: i.text for i in items}, set()
    chosen: dict[UUID, list[tuple[int, str]]] = {}
    used = 0
    # Сначала — материалы без индекса целиком (обрезанные бюджетом позже), затем лучшие куски.
    first = {
        c.item_id: c
        for c in db.scalars(
            select(KnowledgeChunk).where(
                KnowledgeChunk.item_id.in_([i.id for i in indexed]), KnowledgeChunk.position == 0
            )
        ).all()
    }
    for iid, c in first.items():
        chosen.setdefault(iid, []).append((0, c.text))
        used += len(c.text)
    pos = {
        (c.item_id, c.text): c.position
        for c in db.scalars(
            select(KnowledgeChunk).where(KnowledgeChunk.item_id.in_([h.item_id for h in hits]))
        ).all()
    }
    for h in hits:
        if used >= budget:
            break
        p = pos.get((h.item_id, h.text), 999)
        if any(x[0] == p for x in chosen.get(h.item_id, [])):
            continue
        chosen.setdefault(h.item_id, []).append((p, h.text))
        used += len(h.text)
    texts: dict[UUID, str] = {}
    for i in items:
        if i.id in chosen:
            parts = sorted(chosen[i.id])
            texts[i.id] = "\n[…]\n".join(t for _, t in parts)
        else:
            texts[i.id] = i.text
    fragmented = {i.id for i in indexed if len(texts[i.id]) < len(i.text)}
    return texts, fragmented
