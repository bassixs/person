"""Доменные операции над темами (PROJECT_CONTEXT §8, §9.4, §13.3). Все правила — на backend.

Ключевое:
- активная версия неизменна (триггер), правки — только в черновике;
  следующий черновик создаётся от активной;
- подтвердить (verified) или опровергнуть (refuted) утверждение может только редактор, и verified —
  только с конкретным источником (ссылка или документ базы знаний);
- правка текста/источников подтверждённого утверждения не-редактором снимает подтверждение
  (статус «проверено» нельзя переносить на другое содержание без контроля, §9.4);
- срочная пометка утверждения активной версии не переписывает версию: журнал topic_claim_flags.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.deps import Principal
from app.errors import ApiError, forbidden, not_found
from app.models import Topic, TopicClaimFlag, TopicVersion
from app.rbac import Perm
from app.topic_dossier import (
    DOSSIER_SCHEMA_VERSION,
    EDITOR_ONLY_STATUSES,
    Claim,
    Dossier,
    dossier_hash,
    effective_status,
    empty_dossier,
    safe_to_use,
)

UNSAFE_FLAGS = ("refuted", "disputed", "stale")


@dataclass
class Issue:
    code: str
    message: str


# ---------- видимость ----------


def visible_topic(db: Session, p: Principal, topic_id: UUID) -> Topic:
    topic = db.get(Topic, topic_id)
    if topic is None:
        raise not_found("Тема")
    if not p.has(Perm.TOPIC_READ_ALL):
        if not (p.has(Perm.TOPIC_READ_ACTIVE) and topic.active_version_id):
            raise not_found("Тема")
    return topic


def visible_version(db: Session, p: Principal, topic: Topic, version_id: UUID) -> TopicVersion:
    v = db.get(TopicVersion, version_id)
    if v is None or v.topic_id != topic.id:
        raise not_found("Версия темы")
    if not p.has(Perm.TOPIC_READ_ALL) and v.state != "active":
        raise not_found("Версия темы")
    return v


def current_draft(db: Session, topic_id: UUID) -> TopicVersion | None:
    return db.scalar(
        select(TopicVersion).where(TopicVersion.topic_id == topic_id, TopicVersion.state == "draft")
    )


def dossier_of(v: TopicVersion) -> Dossier:
    return Dossier.model_validate(v.dossier)


# ---------- пометки утверждений ----------


def current_flags(db: Session, topic_id: UUID) -> dict[UUID, TopicClaimFlag]:
    """Действующие пометки: последняя запись по каждому утверждению, кроме «снято»."""
    rows = db.scalars(
        select(TopicClaimFlag)
        .where(TopicClaimFlag.topic_id == topic_id)
        .order_by(TopicClaimFlag.created_at, TopicClaimFlag.id)
    ).all()
    latest: dict[UUID, TopicClaimFlag] = {}
    for r in rows:
        latest[r.claim_id] = r
    return {k: v for k, v in latest.items() if v.flag != "cleared"}


def effective_claims(
    dossier: Dossier, flags: dict[UUID, TopicClaimFlag], today: date | None = None
) -> list[tuple[Claim, str, TopicClaimFlag | None]]:
    today = today or date.today()
    out = []
    for c in dossier.claims:
        f = flags.get(c.id)
        out.append((c, effective_status(c, today, f.flag if f else None), f))
    return out


def _rest_status(db: Session, topic: Topic) -> str:
    """Статус темы вне согласования: есть активная версия → active / needs_update."""
    if topic.active_version_id is None:
        return "draft"
    return "needs_update" if current_flags(db, topic.id) else "active"


# ---------- создание и правка ----------


def create_topic(
    db: Session,
    p: Principal,
    *,
    title: str,
    geography: str,
    category: str,
    summary: str,
    creation_mode: str = "manual",
    request: Request | None = None,
) -> Topic:
    topic = Topic(
        title=title.strip(),
        geography=geography.strip(),
        category=category.strip(),
        status="draft",
        creation_mode=creation_mode,
        created_by_id=p.user.id,
    )
    db.add(topic)
    db.flush()
    d = empty_dossier(summary)
    version = TopicVersion(
        topic_id=topic.id,
        version_major=1,
        version_minor=0,
        state="draft",
        schema_version=DOSSIER_SCHEMA_VERSION,
        dossier=d.model_dump(mode="json"),
        content_hash=dossier_hash(d),
        created_by_id=p.user.id,
        updated_by_id=p.user.id,
    )
    db.add(version)
    db.flush()
    audit.record(
        db,
        actor_id=p.user.id,
        action="topic.create",
        entity_type="topic",
        entity_id=topic.id,
        entity_version=version.label,
        details={"mode": creation_mode},
        request=request,
    )
    return topic


def _sources_key(c: Claim) -> list[tuple]:
    return [(s.url, s.knowledge_item_id, s.quote) for s in c.sources]


def apply_claim_rules(
    p: Principal, previous: Dossier, incoming: Dossier, today: date | None = None
) -> tuple[Dossier, list[str]]:
    """Серверный контроль утверждений при ручной правке черновика. Возвращает досье и заметки."""
    today = today or date.today()
    approver = p.has(Perm.TOPIC_APPROVE)
    prev = {c.id: c for c in previous.claims}
    notes: list[str] = []
    out: list[Claim] = []
    for c in incoming.claims:
        old = prev.get(c.id)
        data = c.model_dump()
        # Происхождение задаёт сервер: новое утверждение из ручной правки — «editor».
        data["origin"] = old.origin if old is not None else "editor"
        status_changed = old is None or old.status != c.status
        if status_changed and c.status in EDITOR_ONLY_STATUSES and not approver:
            raise forbidden(
                "Подтвердить или опровергнуть утверждение может только редактор: "
                f"«{c.text[:80]}»"
            )
        if (
            old is not None
            and old.status == "verified"
            and c.status == "verified"
            and not approver
            and (old.text != c.text or _sources_key(old) != _sources_key(c))
        ):
            data["status"] = "unverified"
            notes.append(f"Подтверждение снято после правки: «{c.text[:80]}»")
        if data["status"] == "verified":
            if not any(s.is_concrete for s in c.sources):
                raise ApiError(
                    422,
                    "claim_source_required",
                    "Подтверждённое утверждение должно ссылаться на источник "
                    f"(ссылка или документ): «{c.text[:80]}»",
                )
            if status_changed and data.get("checked_at") is None:
                data["checked_at"] = today
        out.append(Claim.model_validate(data))
    return incoming.model_copy(update={"claims": out}), notes


def update_draft(
    db: Session,
    p: Principal,
    topic: Topic,
    version: TopicVersion,
    incoming: Dossier,
    expected_revision: int,
    change_note: str | None,
    request: Request | None = None,
) -> tuple[TopicVersion, list[str]]:
    if topic.status == "archived":
        raise ApiError(409, "topic_archived", "Тема в архиве")
    if version.state != "draft":
        raise ApiError(409, "version_immutable", "Изменять можно только черновик")
    db.scalar(select(TopicVersion.id).where(TopicVersion.id == version.id).with_for_update())
    db.refresh(version)
    if version.revision != expected_revision:
        raise ApiError(
            409,
            "revision_conflict",
            "Черновик изменён другим пользователем — обновите страницу",
            {"current_revision": version.revision},
        )
    merged, notes = apply_claim_rules(p, dossier_of(version), incoming)
    new_hash = dossier_hash(merged)
    changed = new_hash != version.content_hash
    version.dossier = merged.model_dump(mode="json")
    version.content_hash = new_hash
    if change_note is not None:
        version.change_note = change_note.strip()
    version.revision += 1
    version.updated_by_id = p.user.id
    version.updated_at = datetime.now(UTC)
    if changed and topic.status == "under_review":
        topic.status = _rest_status(db, topic)
    topic.updated_at = datetime.now(UTC)
    db.flush()
    audit.record(
        db,
        actor_id=p.user.id,
        action="topic.update",
        entity_type="topic_version",
        entity_id=version.id,
        entity_version=version.label,
        details={"content_hash": new_hash, "claims": len(merged.claims), "notes": notes},
        request=request,
    )
    return version, notes


def patch_meta(
    db: Session,
    p: Principal,
    topic: Topic,
    *,
    title: str | None,
    geography: str | None,
    category: str | None,
    request: Request | None = None,
) -> Topic:
    if topic.status == "archived":
        raise ApiError(409, "topic_archived", "Тема в архиве")
    changes = {}
    for k, v in (("title", title), ("geography", geography), ("category", category)):
        if v is not None and getattr(topic, k) != v.strip():
            changes[k] = {"from": getattr(topic, k), "to": v.strip()}
            setattr(topic, k, v.strip())
    if changes:
        topic.updated_at = datetime.now(UTC)
        audit.record(
            db,
            actor_id=p.user.id,
            action="topic.meta_update",
            entity_type="topic",
            entity_id=topic.id,
            details=changes,
            request=request,
        )
    return topic


def new_draft_from_active(
    db: Session, p: Principal, topic: Topic, request: Request | None = None
) -> TopicVersion:
    if topic.status == "archived":
        raise ApiError(409, "topic_archived", "Тема в архиве")
    if current_draft(db, topic.id) is not None:
        raise ApiError(409, "draft_exists", "У темы уже есть редактируемый черновик")
    if topic.active_version_id is None:
        raise ApiError(409, "no_active_version", "Нет активной версии, от которой создать черновик")
    base = db.get(TopicVersion, topic.active_version_id)
    assert base is not None
    latest_minor = max(
        v.version_minor for v in topic.versions if v.version_major == base.version_major
    )
    draft = TopicVersion(
        topic_id=topic.id,
        version_major=base.version_major,
        version_minor=latest_minor + 1,
        state="draft",
        schema_version=base.schema_version,
        dossier=base.dossier,
        content_hash=base.content_hash,
        based_on_version_id=base.id,
        created_by_id=p.user.id,
        updated_by_id=p.user.id,
    )
    db.add(draft)
    db.flush()
    audit.record(
        db,
        actor_id=p.user.id,
        action="topic.version_create",
        entity_type="topic_version",
        entity_id=draft.id,
        entity_version=draft.label,
        details={"based_on": base.label},
        request=request,
    )
    return draft


# ---------- согласование и активация ----------


def activation_check(db: Session, version: TopicVersion) -> tuple[list[Issue], list[Issue]]:
    blockers: list[Issue] = []
    warnings: list[Issue] = []
    if version.state != "draft":
        blockers.append(Issue("not_draft", "Утвердить можно только черновик"))
    d = dossier_of(version)
    if not d.summary.strip():
        blockers.append(Issue("summary_missing", "Не заполнена суть темы"))
    for c in d.claims:
        if c.status == "verified" and not any(s.is_concrete for s in c.sources):
            blockers.append(
                Issue("claim_source_missing", f"Подтверждённое без источника: «{c.text[:80]}»")
            )
    flags = current_flags(db, version.topic_id)
    for c in d.claims:
        f = flags.get(c.id)
        if f is not None and c.status == "verified":
            blockers.append(
                Issue(
                    "flag_unresolved",
                    f"Утверждение помечено «{f.flag}», но в черновике подтверждено: "
                    f"«{c.text[:80]}». Измените статус или снимите пометку с причиной.",
                )
            )
    if not d.claims:
        warnings.append(Issue("no_claims", "В досье нет ни одного утверждения с источником"))
    elif not any(c.status == "verified" for c in d.claims):
        warnings.append(Issue("no_verified", "Ни одно утверждение не подтверждено"))
    for c in d.claims:
        if c.kind == "operational" and c.status == "verified" and c.valid_until is None:
            warnings.append(
                Issue(
                    "operational_no_review_date",
                    f"Оперативное утверждение без срока пересмотра: «{c.text[:60]}»",
                )
            )
    today = date.today()
    for c in d.claims:
        if c.status == "verified" and c.valid_until is not None and c.valid_until < today:
            warnings.append(Issue("claim_expired", f"Срок истёк: «{c.text[:60]}»"))
    return blockers, warnings


def submit(
    db: Session, p: Principal, topic: Topic, version: TopicVersion, request: Request | None
) -> Topic:
    if topic.status == "archived":
        raise ApiError(409, "topic_archived", "Тема в архиве")
    if version.state != "draft":
        raise ApiError(409, "not_draft", "На согласование отправляется черновик")
    blockers, _ = activation_check(db, version)
    if blockers:
        raise ApiError(
            409,
            "submit_blocked",
            "Черновик не готов к согласованию",
            [b.__dict__ for b in blockers],
        )
    topic.status = "under_review"
    topic.updated_at = datetime.now(UTC)
    audit.record(
        db,
        actor_id=p.user.id,
        action="topic.submit",
        entity_type="topic_version",
        entity_id=version.id,
        entity_version=version.label,
        details={"content_hash": version.content_hash},
        request=request,
    )
    return topic


def activate(
    db: Session, p: Principal, topic: Topic, version: TopicVersion, request: Request | None
) -> TopicVersion:
    db.scalar(select(Topic.id).where(Topic.id == topic.id).with_for_update())
    db.scalar(select(TopicVersion.id).where(TopicVersion.id == version.id).with_for_update())
    db.refresh(version)
    if topic.status == "archived":
        raise ApiError(409, "topic_archived", "Тема в архиве")
    blockers, warnings = activation_check(db, version)
    if blockers:
        raise ApiError(
            409,
            "activation_blocked",
            "Утверждение темы заблокировано: устраните блокирующие условия",
            [b.__dict__ for b in blockers],
        )
    now = datetime.now(UTC)
    previous = db.get(TopicVersion, topic.active_version_id) if topic.active_version_id else None
    if previous is not None and previous.state == "active":
        previous.state = "superseded"
        db.flush()
    version.state = "active"
    version.approved_by_id = p.user.id
    version.approved_at = now
    topic.active_version_id = version.id
    topic.updated_at = now
    db.flush()
    topic.status = _rest_status(db, topic)
    audit.record(
        db,
        actor_id=p.user.id,
        action="topic.activate",
        entity_type="topic_version",
        entity_id=version.id,
        entity_version=version.label,
        details={
            "content_hash": version.content_hash,
            "superseded": previous.label if previous is not None else None,
            "warnings": [w.code for w in warnings],
        },
        request=request,
    )
    return version


def suspend(
    db: Session,
    p: Principal,
    topic: Topic,
    version: TopicVersion,
    reason: str,
    request: Request | None,
) -> Topic:
    if version.state != "active" or topic.active_version_id != version.id:
        raise ApiError(409, "not_active", "Приостановить можно только активную версию")
    version.state = "suspended"
    topic.active_version_id = None
    topic.status = "suspended"
    topic.updated_at = datetime.now(UTC)
    db.flush()
    audit.record(
        db,
        actor_id=p.user.id,
        action="topic.suspend",
        entity_type="topic_version",
        entity_id=version.id,
        entity_version=version.label,
        details={"reason": reason.strip()},
        request=request,
    )
    return topic


def flag_claim(
    db: Session,
    p: Principal,
    topic: Topic,
    claim_id: UUID,
    flag: str,
    reason: str,
    origin: str = "editor",
    request: Request | None = None,
) -> TopicClaimFlag:
    """Срочная пометка утверждения активной версии; тема остаётся активной (§8.5, D-28)."""
    if topic.active_version_id is None:
        raise ApiError(409, "no_active_version", "Пометки ставятся на утверждения активной версии")
    active = db.get(TopicVersion, topic.active_version_id)
    assert active is not None
    if not any(c.id == claim_id for c in dossier_of(active).claims):
        raise not_found("Утверждение в активной версии")
    current = current_flags(db, topic.id).get(claim_id)
    if flag == "cleared" and current is None:
        raise ApiError(409, "no_flag", "У утверждения нет действующей пометки")
    row = TopicClaimFlag(
        topic_id=topic.id,
        version_id=active.id,
        claim_id=claim_id,
        flag=flag,
        reason=reason.strip(),
        origin=origin,
        created_by_id=p.user.id,
    )
    db.add(row)
    db.flush()
    if topic.status in ("active", "needs_update"):
        topic.status = _rest_status(db, topic)
    topic.updated_at = datetime.now(UTC)
    audit.record(
        db,
        actor_id=p.user.id,
        action="topic.claim_flag" if flag != "cleared" else "topic.claim_unflag",
        entity_type="topic_version",
        entity_id=active.id,
        entity_version=active.label,
        details={"claim_id": str(claim_id), "flag": flag, "reason": reason.strip()},
        request=request,
    )
    return row


def archive(db: Session, p: Principal, topic: Topic, request: Request | None) -> None:
    if topic.status == "archived":
        return
    topic.status_before_archive = topic.status
    topic.status = "archived"
    topic.archived_at = datetime.now(UTC)
    audit.record(
        db,
        actor_id=p.user.id,
        action="topic.archive",
        entity_type="topic",
        entity_id=topic.id,
        request=request,
    )


def unarchive(db: Session, p: Principal, topic: Topic, request: Request | None) -> None:
    if topic.status != "archived":
        return
    topic.status = topic.status_before_archive or _rest_status(db, topic)
    topic.status_before_archive = None
    topic.archived_at = None
    audit.record(
        db,
        actor_id=p.user.id,
        action="topic.unarchive",
        entity_type="topic",
        entity_id=topic.id,
        request=request,
    )


def safe_claim_count(dossier: Dossier, flags: dict[UUID, TopicClaimFlag]) -> tuple[int, int]:
    eff = effective_claims(dossier, flags)
    verified = sum(1 for _, s, _ in eff if safe_to_use(s))
    unsafe = sum(1 for _, s, _ in eff if s in ("refuted", "disputed", "stale"))
    return verified, unsafe
