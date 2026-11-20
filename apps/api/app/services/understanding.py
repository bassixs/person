"""Карточка понимания темы (PROJECT_CONTEXT §8.4, D-17, D-18).

- Запуск в фоне по текущему черновику досье и материалам темы (материалы, связанные с темой).
- Ссылки модели на материалы переводятся в id; каждая цитата сверяется с текстом материала —
  результат `quote_found`. Ненайденная цитата не прикрепляется к утверждению как подтверждение.
- Карточка актуальна, пока не изменились досье (content_hash) и набор материалов (materials_hash).
- В досье ничего не попадает автоматически: редактор переносит пункт в черновик,
  утверждение — со статусом «не проверено» и происхождением «предложение ИИ».
"""

import hashlib
import re
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit, jobs
from app.ai import topic_researcher as skill
from app.ai.client import SkillCall, llm_configured, run_skill
from app.config import model_for
from app.db import session_factory
from app.deps import Principal
from app.errors import ApiError, not_found
from app.models import KnowledgeItem, KnowledgeItemTopic, Topic, TopicUnderstandingRun, TopicVersion
from app.services import semantic
from app.services import topics as tsvc
from app.topic_dossier import Claim, ClaimSource, dossier_hash

STUCK_AFTER = timedelta(minutes=15)
APPLY_KINDS = ("fact", "unverified", "conflict", "question", "gap")


def _norm(s: str) -> str:
    s = s.lower().replace("ё", "е")
    s = re.sub(r"[«»\"„“”'`]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def topic_materials(db: Session, topic_id: UUID) -> list[KnowledgeItem]:
    return list(
        db.scalars(
            select(KnowledgeItem)
            .where(
                KnowledgeItem.id.in_(
                    select(KnowledgeItemTopic.item_id).where(
                        KnowledgeItemTopic.topic_id == topic_id
                    )
                ),
                KnowledgeItem.archived_at.is_(None),
            )
            .order_by(KnowledgeItem.created_at)
        ).all()
    )


def materials_hash(items: list[KnowledgeItem]) -> str:
    key = "|".join(sorted(f"{i.id}:{i.sha256}" for i in items))
    return hashlib.sha256(key.encode()).hexdigest()


def is_current(db: Session, run: TopicUnderstandingRun) -> bool:
    v = db.get(TopicVersion, run.version_id)
    if v is None or v.content_hash != run.content_hash:
        return False
    return materials_hash(topic_materials(db, run.topic_id)) == run.materials_hash


def expire_stuck(db: Session, topic_id: UUID) -> None:
    limit = datetime.now(UTC) - STUCK_AFTER
    for r in db.scalars(
        select(TopicUnderstandingRun).where(
            TopicUnderstandingRun.topic_id == topic_id,
            TopicUnderstandingRun.status.in_(("queued", "running")),
            TopicUnderstandingRun.created_at < limit,
        )
    ).all():
        r.status = "failed"
        r.error = "Разбор прерван (сервер перезапускался). Запустите снова."
        r.finished_at = datetime.now(UTC)


def start(
    db: Session, p: Principal, topic: Topic, request: Request | None
) -> TopicUnderstandingRun:
    draft = tsvc.current_draft(db, topic.id)
    if draft is None:
        raise ApiError(409, "no_draft", "Карточка понимания строится по черновику темы")
    if not llm_configured():
        raise ApiError(503, "llm_not_configured", "ИИ не подключён: карточка понимания недоступна.")
    items = topic_materials(db, topic.id)
    mh = materials_hash(items)
    busy = db.scalar(
        select(TopicUnderstandingRun).where(
            TopicUnderstandingRun.version_id == draft.id,
            TopicUnderstandingRun.content_hash == draft.content_hash,
            TopicUnderstandingRun.materials_hash == mh,
            TopicUnderstandingRun.status.in_(("queued", "running")),
        )
    )
    if busy is not None:
        return busy
    run = TopicUnderstandingRun(
        topic_id=topic.id,
        version_id=draft.id,
        content_hash=draft.content_hash,
        materials_hash=mh,
        materials=[
            {"ref": f"M{n}", "item_id": str(i.id), "title": i.title, "sha256": i.sha256}
            for n, i in enumerate(items, start=1)
        ],
        status="queued",
        model=model_for("check"),
        skill_version=skill.VERSION,
        started_by_id=p.user.id,
    )
    db.add(run)
    db.flush()
    audit.record(
        db,
        actor_id=p.user.id,
        action="topic.understanding_start",
        entity_type="topic_version",
        entity_id=draft.id,
        entity_version=draft.label,
        details={"materials": len(items)},
        request=request,
    )
    return run


def schedule(run: TopicUnderstandingRun) -> None:
    jobs.submit(execute, run.id)


def _refs(refs: list[skill.RefOut], by_ref: dict[str, KnowledgeItem]) -> list[dict[str, Any]]:
    out = []
    for r in refs:
        item = by_ref.get(r.material.strip().upper())
        if item is None:
            continue  # модель сослалась на несуществующий материал — ссылку не сохраняем
        quote = r.quote.strip()
        found = bool(quote) and _norm(quote) in _norm(item.text)
        out.append(
            {"item_id": str(item.id), "title": item.title, "quote": quote, "quote_found": found}
        )
    return out


def execute(run_id: UUID) -> None:
    with session_factory()() as db:
        run = db.get(TopicUnderstandingRun, run_id)
        if run is None or run.status != "queued":
            return
        run.status = "running"
        db.commit()
        topic = db.get(Topic, run.topic_id)
        version = db.get(TopicVersion, run.version_id)
        assert topic is not None and version is not None
        items = {str(i.id): i for i in topic_materials(db, topic.id)}
        by_ref = {m["ref"]: items[m["item_id"]] for m in run.materials if m["item_id"] in items}
        try:
            if version.content_hash != run.content_hash:
                raise ApiError(409, "content_changed", "Досье изменилось до начала разбора")
            d = version.dossier
            query = " ".join(
                [topic.title, d.get("summary", ""), *d.get("residents_questions", [])[:10]]
            )
            texts, fragmented = semantic.select_context(
                db, list(by_ref.values()), query, skill.MATERIALS_BUDGET
            )
            mats = skill.budgeted(
                [
                    {
                        "ref": ref,
                        "title": it.title,
                        "format": it.format,
                        "text": texts.get(it.id) or f"(текст не извлечён: {it.extraction_note})",
                        "published_at": str(it.published_at) if it.published_at else None,
                    }
                    for ref, it in by_ref.items()
                ]
            )
            for m, it in zip(mats, by_ref.values(), strict=True):
                m["fragments"] = it.id in fragmented
            result, model = run_skill(
                SkillCall(
                    skill=skill.SKILL,
                    version=skill.VERSION,
                    system=skill.SYSTEM,
                    user=skill.prompt(
                        version.dossier,
                        {
                            "title": topic.title,
                            "geography": topic.geography,
                            "category": topic.category,
                        },
                        mats,
                    ),
                    actor_id=run.started_by_id,
                    entity_type="topic",
                    entity_id=str(topic.id),
                    model=run.model,
                ),
                skill.CardOut,
            )
        except ApiError as e:
            run.status = "failed"
            run.error = e.message
            run.finished_at = datetime.now(UTC)
            db.commit()
            return
        card: dict[str, Any] = {
            "summary": result.summary,
            "known_facts": [
                {"text": f.text, "refs": _refs(f.refs, by_ref)} for f in result.known_facts
            ],
            "unverified_claims": [
                {"text": u.text, "reason": u.reason} for u in result.unverified_claims
            ],
            "conflicts": [
                {"text": c.text, "refs": _refs(c.refs, by_ref)} for c in result.conflicts
            ],
            "open_questions": result.open_questions,
            "gaps": result.gaps,
            "understood": result.understood,
            "understood_reason": result.understood_reason,
            "sources": [
                {
                    "ref": ref,
                    "item_id": str(it.id),
                    "title": it.title,
                    "truncated": m["truncated"],
                    "fragments": m["fragments"],
                }
                for (ref, it), m in zip(by_ref.items(), mats, strict=True)
            ],
        }
        run.card = card
        run.model = model or run.model
        run.status = "done"
        run.finished_at = datetime.now(UTC)
        audit.record(
            db,
            actor_id=run.started_by_id,
            action="topic.understanding_done",
            entity_type="topic_version",
            entity_id=version.id,
            entity_version=version.label,
            details={
                "facts": len(card["known_facts"]),
                "quotes_not_found": sum(
                    1 for f in card["known_facts"] for r in f["refs"] if not r["quote_found"]
                ),
                "understood": result.understood,
            },
        )
        db.commit()


def latest(db: Session, topic_id: UUID) -> TopicUnderstandingRun | None:
    return db.scalar(
        select(TopicUnderstandingRun)
        .where(TopicUnderstandingRun.topic_id == topic_id)
        .order_by(TopicUnderstandingRun.created_at.desc())
    )


def current_done(db: Session, version: TopicVersion) -> TopicUnderstandingRun | None:
    run = db.scalar(
        select(TopicUnderstandingRun)
        .where(
            TopicUnderstandingRun.version_id == version.id,
            TopicUnderstandingRun.content_hash == version.content_hash,
            TopicUnderstandingRun.status == "done",
        )
        .order_by(TopicUnderstandingRun.finished_at.desc())
    )
    if run is None:
        return None
    mh = materials_hash(topic_materials(db, version.topic_id))
    return run if run.materials_hash == mh else None


def apply_item(
    db: Session,
    p: Principal,
    topic: Topic,
    run: TopicUnderstandingRun,
    kind: str,
    index: int,
    request: Request | None,
) -> TopicVersion:
    """Переносит пункт карточки в черновик досье (решение редактора, не ИИ)."""
    if kind not in APPLY_KINDS:
        raise ApiError(422, "invalid_kind", "Неизвестный вид пункта")
    if run.status != "done" or run.card is None:
        raise ApiError(409, "run_not_done", "Карточка ещё не готова")
    draft = tsvc.current_draft(db, topic.id)
    if draft is None or draft.id != run.version_id:
        raise ApiError(409, "run_outdated", "Карточка относится к другой версии темы")
    key = {
        "fact": "known_facts",
        "unverified": "unverified_claims",
        "conflict": "conflicts",
        "question": "open_questions",
        "gap": "gaps",
    }[kind]
    entries = run.card.get(key, [])
    if not 0 <= index < len(entries):
        raise not_found("Пункт карточки")
    entry = entries[index]
    d = tsvc.dossier_of(draft)
    if kind in ("fact", "unverified"):
        text = entry["text"]
        if any(_norm(c.text) == _norm(text) for c in d.claims):
            raise ApiError(409, "already_applied", "Такое утверждение уже есть в черновике")
        sources: list[ClaimSource] = []
        items = {str(i.id): i for i in topic_materials(db, topic.id)}
        for r in entry.get("refs", []):
            it = items.get(r["item_id"])
            if it is None:
                continue
            sources.append(
                ClaimSource(
                    title=it.title,
                    url=it.final_url or it.url,
                    quote=r["quote"][:4000] if r["quote_found"] else None,
                    knowledge_item_id=it.id,
                )
            )
        note = "Из карточки понимания ИИ. Проверьте источник перед подтверждением."
        if kind == "unverified":
            note = f"Не подтверждено материалами: {entry.get('reason', '')}"[:2000]
        claim = Claim(
            text=text[:2000],
            status="unverified",
            origin="ai_suggestion",
            sources=sources,
            note=note,
        )
        d = d.model_copy(update={"claims": [*d.claims, claim]})
    else:
        text = entry["text"] if isinstance(entry, dict) else entry
        field = {"conflict": "conflicts", "question": "residents_questions", "gap": "unknowns"}[
            kind
        ]
        current = getattr(d, field)
        if any(_norm(x) == _norm(text) for x in current):
            raise ApiError(409, "already_applied", "Этот пункт уже есть в черновике")
        d = d.model_copy(update={field: [*current, text[:2000]]})
    draft.dossier = d.model_dump(mode="json")
    draft.content_hash = dossier_hash(d)
    draft.revision += 1
    draft.updated_by_id = p.user.id
    draft.updated_at = datetime.now(UTC)
    if topic.status == "under_review":
        topic.status = tsvc._rest_status(db, topic)
    topic.updated_at = datetime.now(UTC)
    audit.record(
        db,
        actor_id=p.user.id,
        action="topic.understanding_apply",
        entity_type="topic_version",
        entity_id=draft.id,
        entity_version=draft.label,
        details={"run_id": str(run.id), "kind": kind, "index": index, "text": text[:300]},
        request=request,
    )
    return draft
