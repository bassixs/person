"""Доменные операции над персонами. Все бизнес-правила — здесь, на backend."""

from datetime import UTC, datetime
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.deps import Principal
from app.errors import ApiError, not_found
from app.models import Persona, PersonaSourceMaterial, PersonaVersion, ValidationRun
from app.passport import (
    SCHEMA_VERSION,
    Passport,
    PassportField,
    content_hash,
    empty_passport,
    merge_editor_update,
)
from app.rbac import Perm
from app.services.proposals import refresh_stale


def visible_persona(db: Session, p: Principal, persona_id: UUID) -> Persona:
    persona = db.get(Persona, persona_id)
    if persona is None:
        raise not_found("Личность")
    if not p.has(Perm.PERSONA_READ_ALL):
        # Оператор видит только персоны с утверждённой активной версией.
        if not (p.has(Perm.PERSONA_READ_ACTIVE) and persona.active_version_id):
            raise not_found("Личность")
    return persona


def visible_version(
    db: Session, p: Principal, persona: Persona, version_id: UUID
) -> PersonaVersion:
    v = db.get(PersonaVersion, version_id)
    if v is None or v.persona_id != persona.id:
        raise not_found("Версия")
    if not p.has(Perm.PERSONA_READ_ALL) and v.state != "active":
        raise not_found("Версия")
    return v


def current_draft(db: Session, persona_id: UUID) -> PersonaVersion | None:
    return db.scalar(
        select(PersonaVersion).where(
            PersonaVersion.persona_id == persona_id, PersonaVersion.state == "draft"
        )
    )


def create_persona(
    db: Session,
    p: Principal,
    *,
    display_name: str,
    short_context: str,
    mode: str,
    legend_text: str | None,
    is_seed: bool = False,
    initial_passport: Passport | None = None,
    request: Request | None = None,
) -> Persona:
    if mode == "legend" and not (legend_text and legend_text.strip()):
        raise ApiError(422, "legend_required", "Для создания из легенды нужен текст легенды")

    passport = initial_passport or empty_passport()
    if initial_passport is None:
        passport.sections["legend"].fields["full_name"] = PassportField(
            value=display_name,
            source_kind="original_legend" if mode == "legend" else "editor",
            certainty="defined",
            editor_approved=mode != "legend",
        )
    persona = Persona(
        display_name=display_name.strip(),
        short_context=short_context.strip(),
        status="draft",
        creation_mode=mode,
        is_seed=is_seed,
        created_by_id=p.user.id,
    )
    db.add(persona)
    db.flush()
    version = PersonaVersion(
        persona_id=persona.id,
        version_major=1,
        version_minor=0,
        state="draft",
        schema_version=SCHEMA_VERSION,
        passport=passport.model_dump(mode="json"),
        content_hash=content_hash(passport),
        revision=1,
        created_by_id=p.user.id,
        updated_by_id=p.user.id,
    )
    db.add(version)
    if legend_text and legend_text.strip():
        db.add(
            PersonaSourceMaterial(
                persona_id=persona.id,
                kind="original_legend",
                content=legend_text.strip(),
                created_by_id=p.user.id,
            )
        )
    db.flush()
    audit.record(
        db,
        actor_id=p.user.id,
        action="persona.create",
        entity_type="persona",
        entity_id=persona.id,
        entity_version=version.label,
        details={"mode": mode, "is_seed": is_seed},
        request=request,
    )
    return persona


def update_draft(
    db: Session,
    p: Principal,
    persona: Persona,
    version: PersonaVersion,
    incoming: Passport,
    expected_revision: int,
    request: Request | None = None,
) -> PersonaVersion:
    if persona.status == "archived":
        raise ApiError(409, "persona_archived", "Личность в архиве: сначала верните её из архива")
    if version.state != "draft":
        raise ApiError(
            409,
            "version_immutable",
            f"Версия {version.label} в состоянии «{version.state}» неизменяема. "
            "Создайте новый черновик.",
        )
    # Optimistic locking: блокируем строку и сверяем ревизию.
    locked_revision = db.scalar(
        select(PersonaVersion.revision).where(PersonaVersion.id == version.id).with_for_update()
    )
    db.refresh(version)
    if locked_revision != expected_revision:
        raise ApiError(
            409,
            "revision_conflict",
            "Черновик изменён другим пользователем или в другой вкладке. "
            "Обновите страницу, чтобы не потерять чужие правки.",
            {"current_revision": version.revision},
        )
    previous = Passport.model_validate(version.passport)
    merged, changed = merge_editor_update(previous, incoming)
    if not changed:
        return version
    new_hash = content_hash(merged)
    version.passport = merged.model_dump(mode="json")
    version.content_hash = new_hash
    version.revision += 1
    version.updated_by_id = p.user.id
    version.updated_at = datetime.now(UTC)
    name = merged.sections["legend"].fields["full_name"]
    if isinstance(name.value, str) and name.value:
        persona.display_name = name.value
    persona.updated_at = datetime.now(UTC)
    if persona.status in ("pending_approval", "needs_revision"):
        # Содержимое изменилось после отправки на согласование — снова черновик (Q-005).
        persona.status = "draft"
    db.flush()
    stale = refresh_stale(db, version)
    audit.record(
        db,
        actor_id=p.user.id,
        action="persona.edit",
        entity_type="persona_version",
        entity_id=version.id,
        entity_version=version.label,
        details={
            "changed": changed,
            "content_hash": new_hash,
            "revision": version.revision,
            "proposals_stale": stale,
        },
        request=request,
    )
    return version


def new_draft_from_latest(
    db: Session, p: Principal, persona: Persona, request: Request | None = None
) -> PersonaVersion:
    if persona.status == "archived":
        raise ApiError(409, "persona_archived", "Личность в архиве")
    if current_draft(db, persona.id) is not None:
        raise ApiError(409, "draft_exists", "У личности уже есть редактируемый черновик")
    if persona.active_version_id is None:
        raise ApiError(409, "no_active_version", "Нет активной версии, от которой создать черновик")
    base = db.get(PersonaVersion, persona.active_version_id)
    assert base is not None
    latest_minor = max(
        v.version_minor for v in persona.versions if v.version_major == base.version_major
    )
    draft = PersonaVersion(
        persona_id=persona.id,
        version_major=base.version_major,
        version_minor=latest_minor + 1,
        state="draft",
        schema_version=base.schema_version,
        passport=base.passport,
        content_hash=base.content_hash,
        revision=1,
        based_on_version_id=base.id,
        created_by_id=p.user.id,
        updated_by_id=p.user.id,
    )
    db.add(draft)
    db.flush()
    audit.record(
        db,
        actor_id=p.user.id,
        action="persona.version_create",
        entity_type="persona_version",
        entity_id=draft.id,
        entity_version=draft.label,
        details={"based_on": base.label},
        request=request,
    )
    return draft


def archive(db: Session, p: Principal, persona: Persona, request: Request | None = None) -> None:
    if persona.status == "archived":
        return
    persona.status_before_archive = persona.status
    persona.status = "archived"
    persona.archived_at = datetime.now(UTC)
    audit.record(
        db,
        actor_id=p.user.id,
        action="persona.archive",
        entity_type="persona",
        entity_id=persona.id,
        request=request,
    )


def unarchive(db: Session, p: Principal, persona: Persona, request: Request | None = None) -> None:
    if persona.status != "archived":
        return
    persona.status = persona.status_before_archive or "draft"
    persona.status_before_archive = None
    persona.archived_at = None
    audit.record(
        db,
        actor_id=p.user.id,
        action="persona.unarchive",
        entity_type="persona",
        entity_id=persona.id,
        request=request,
    )


# ---------- Согласование, активация, приостановка (PROJECT_CONTEXT §7.4) ----------


def submit_for_approval(
    db: Session, p: Principal, persona: Persona, version: PersonaVersion, request: Request | None
) -> None:
    """Q-005 (решение владельца): отправляют автор и редактор.

    Нужна актуальная проверка целостности без critical.
    """
    if persona.status == "archived":
        raise ApiError(409, "persona_archived", "Личность в архиве")
    if version.state != "draft":
        raise ApiError(409, "not_draft", "На согласование отправляется черновик")
    fresh = db.scalar(
        select(ValidationRun)
        .where(
            ValidationRun.version_id == version.id,
            ValidationRun.content_hash == version.content_hash,
            ValidationRun.status == "done",
        )
        .order_by(ValidationRun.finished_at.desc())
    )
    if fresh is None:
        raise ApiError(
            409,
            "validation_required",
            "Сначала проверьте целостность паспорта: "
            "проверка должна относиться к текущему содержимому",
        )
    if fresh.critical_count:
        raise ApiError(
            409,
            "validation_critical",
            f"Проверка нашла критические противоречия: {fresh.critical_count}. "
            "Исправьте их перед отправкой",
        )
    persona.status = "pending_approval"
    persona.updated_at = datetime.now(UTC)
    audit.record(
        db,
        actor_id=p.user.id,
        action="persona.submit",
        entity_type="persona_version",
        entity_id=version.id,
        entity_version=version.label,
        details={"content_hash": version.content_hash, "validation_run": str(fresh.id)},
        request=request,
    )


def activate(
    db: Session, p: Principal, persona: Persona, version: PersonaVersion, request: Request | None
) -> PersonaVersion:
    """Черновик → активная версия. Барьер пересчитывается внутри транзакции под блокировкой."""
    from app.activation import activation_blockers  # локально: activation импортирует модели

    db.scalar(select(Persona.id).where(Persona.id == persona.id).with_for_update())
    db.scalar(select(PersonaVersion.id).where(PersonaVersion.id == version.id).with_for_update())
    db.refresh(version)
    blockers = activation_blockers(db, version)
    if blockers:
        raise ApiError(
            409,
            "activation_blocked",
            "Активация заблокирована: устраните блокирующие условия",
            [b.__dict__ for b in blockers],
        )
    now = datetime.now(UTC)
    previous = (
        db.get(PersonaVersion, persona.active_version_id) if persona.active_version_id else None
    )
    if previous is not None and previous.state == "active":
        previous.state = "superseded"
        db.flush()  # одна активная версия на персону (частичный уникальный индекс)
    version.state = "active"
    version.approved_by_id = p.user.id
    version.approved_at = now
    persona.active_version_id = version.id
    persona.status = "active"
    persona.updated_at = now
    db.flush()
    refresh_stale(db, version)  # неразобранные предложения к бывшему черновику устаревают
    audit.record(
        db,
        actor_id=p.user.id,
        action="persona.activate",
        entity_type="persona_version",
        entity_id=version.id,
        entity_version=version.label,
        details={
            "content_hash": version.content_hash,
            "superseded": previous.label if previous is not None else None,
        },
        request=request,
    )
    return version


def suspend(
    db: Session,
    p: Principal,
    persona: Persona,
    version: PersonaVersion,
    reason: str,
    request: Request | None,
) -> None:
    """Экстренная приостановка активной версии: отдельное действие с журналом причины."""
    if version.state != "active":
        raise ApiError(409, "not_active", "Приостановить можно только активную версию")
    if not reason.strip():
        raise ApiError(422, "reason_required", "Укажите причину приостановки")
    version.state = "suspended"
    if persona.active_version_id == version.id:
        persona.active_version_id = None
    persona.status = "suspended"
    persona.updated_at = datetime.now(UTC)
    audit.record(
        db,
        actor_id=p.user.id,
        action="persona.suspend",
        entity_type="persona_version",
        entity_id=version.id,
        entity_version=version.label,
        details={"reason": reason.strip()[:1000]},
        request=request,
    )
