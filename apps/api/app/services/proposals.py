"""Очередь предложений ИИ (ТЗ §3, PROJECT_CONTEXT §6.6).

- Предложение касается одного поля или нарратива черновика и хранит «было» на момент создания.
- Устаревание (E-024): pending-предложение становится stale, когда целевое поле черновика изменилось
  после его создания (правка вручную или принятие другого предложения) либо черновик перестал быть
  черновиком. Изменения других полей предложение не портят.
- Принятие — только на сервере, с optimistic lock по revision, пересчётом content_hash и аудитом.
  Исходное предложение неизменно (триггер БД); правка редактора хранится в edited_*.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.ai.interviewer import LOCKED_PATHS, PROPOSABLE_PATHS, ProposalOut
from app.deps import Principal
from app.errors import ApiError
from app.models import ChangeProposal, Persona, PersonaVersion
from app.passport import FIELD_TYPES, Passport, PassportField, content_hash


def get_path(passport: Passport, path: str) -> Any:
    section, key = path.split(".", 1)
    sec = passport.sections[section]
    return (sec.narrative or None) if key == "narrative" else sec.fields[key].value


def _same(a: Any, b: Any) -> bool:
    return (a or None) == (b or None)


def create_from_ai(
    db: Session,
    p: Principal,
    persona: Persona,
    version: PersonaVersion,
    items: list[ProposalOut],
    *,
    origin: str,
    session_id: UUID | None,
    generator: dict[str, Any],
) -> list[ChangeProposal]:
    passport = Passport.model_validate(version.passport)
    seen: set[str] = set()
    created: list[ChangeProposal] = []
    for it in items:
        if it.field_path in seen or it.field_path in LOCKED_PATHS:
            continue
        seen.add(it.field_path)
        before = get_path(passport, it.field_path)
        if _same(before, it.value):
            continue  # предлагать то, что уже есть, бессмысленно
        pr = ChangeProposal(
            persona_id=persona.id,
            version_id=version.id,
            origin=origin,
            interview_session_id=session_id,
            field_path=it.field_path,
            before_value=before,
            proposed_value=it.value,
            proposed_certainty=it.certainty,
            rationale=it.rationale.strip(),
            related_paths=it.related_paths,
            base_content_hash=version.content_hash,
            status="pending",
            generator=generator,
            created_by_id=p.user.id,
        )
        db.add(pr)
        created.append(pr)
    db.flush()
    return created


def refresh_stale(db: Session, version: PersonaVersion) -> int:
    """Помечает устаревшими pending-предложения этой версии, чьё поле изменилось."""
    pending = db.scalars(
        select(ChangeProposal).where(
            ChangeProposal.version_id == version.id, ChangeProposal.status == "pending"
        )
    ).all()
    if not pending:
        return 0
    n = 0
    if version.state != "draft":
        for pr in pending:
            pr.status = "stale"
            pr.stale_reason = f"Версия {version.label} больше не черновик"
            n += 1
        return n
    passport = Passport.model_validate(version.passport)
    for pr in pending:
        if not _same(get_path(passport, pr.field_path), pr.before_value):
            pr.status = "stale"
            pr.stale_reason = "Поле изменилось после создания предложения"
            n += 1
    return n


def _validate_value(path: str, value: Any, certainty: str) -> Any:
    if path not in PROPOSABLE_PATHS:
        raise ApiError(422, "field_locked", "Это поле нельзя менять через предложение")
    section, key = path.split(".", 1)
    if key == "narrative":
        if not isinstance(value, str) or not value.strip():
            raise ApiError(422, "invalid_value", "Нарратив должен быть непустым текстом")
        return value.strip()
    is_list = FIELD_TYPES[section][key] == "tags"
    if is_list and not isinstance(value, list):
        raise ApiError(422, "invalid_value", "Для этого поля нужен список")
    if not is_list and not isinstance(value, str):
        raise ApiError(422, "invalid_value", "Для этого поля нужен текст")
    if certainty not in ("defined", "hypothesis"):
        raise ApiError(422, "invalid_certainty", "Определённость: «определено» или «гипотеза»")
    try:
        fld = PassportField(value=value, certainty=certainty)  # type: ignore[arg-type]
    except ValueError as e:
        raise ApiError(422, "invalid_value", str(e)) from e
    if fld.value is None:
        raise ApiError(
            422, "invalid_value", "Пустое значение: отклоните предложение вместо принятия"
        )
    return fld.value


def _lock_draft(db: Session, version: PersonaVersion, expected_revision: int) -> None:
    locked = db.scalar(
        select(PersonaVersion.revision).where(PersonaVersion.id == version.id).with_for_update()
    )
    db.refresh(version)
    if locked != expected_revision:
        raise ApiError(
            409,
            "revision_conflict",
            "Черновик изменён в другой вкладке или другим пользователем. Обновите страницу.",
            {"current_revision": version.revision},
        )


def accept(
    db: Session,
    p: Principal,
    persona: Persona,
    pr: ChangeProposal,
    *,
    expected_revision: int,
    value: Any = None,
    certainty: str | None = None,
    note: str | None = None,
    request: Request | None = None,
) -> PersonaVersion:
    if persona.status == "archived":
        raise ApiError(409, "persona_archived", "Личность в архиве")
    version = db.get(PersonaVersion, pr.version_id)
    assert version is not None
    _lock_draft(db, version, expected_revision)
    refresh_stale(db, version)
    if pr.status != "pending":
        db.flush()
        raise ApiError(
            409,
            f"proposal_{pr.status}",
            "Предложение устарело: поле изменилось после его создания."
            if pr.status == "stale"
            else "Решение по предложению уже принято",
        )
    edited = value is not None or (certainty is not None and certainty != pr.proposed_certainty)
    final_certainty = certainty or pr.proposed_certainty
    final_value = _validate_value(
        pr.field_path, pr.proposed_value if value is None else value, final_certainty
    )

    passport = Passport.model_validate(version.passport)
    section, key = pr.field_path.split(".", 1)
    if key == "narrative":
        passport.sections[section].narrative = final_value
    else:
        prev = passport.sections[section].fields[key]
        passport.sections[section].fields[key] = PassportField(
            value=final_value,
            # Правка редактора перед принятием делает его автором значения.
            source_kind="editor" if edited else "ai_suggestion",
            certainty=final_certainty,  # type: ignore[arg-type]
            editor_approved=True,
            dependencies=sorted(
                set(prev.dependencies)
                | {x for x in pr.related_paths if not x.endswith(".narrative")}
            ),
        )
    passport = Passport.model_validate(passport.model_dump(mode="json"))
    new_hash = content_hash(passport)
    version.passport = passport.model_dump(mode="json")
    version.content_hash = new_hash
    version.revision += 1
    version.updated_by_id = p.user.id
    version.updated_at = datetime.now(UTC)
    persona.updated_at = datetime.now(UTC)

    now = datetime.now(UTC)
    pr.status = "accepted"
    pr.decided_by_id = p.user.id
    pr.decided_at = now
    pr.decision_note = (note or "").strip() or None
    if edited:
        pr.edited_value = final_value
        pr.edited_certainty = final_certainty
    db.flush()
    refresh_stale(db, version)
    audit.record(
        db,
        actor_id=p.user.id,
        action="persona.proposal_accept",
        entity_type="persona_version",
        entity_id=version.id,
        entity_version=version.label,
        details={
            "proposal_id": str(pr.id),
            "field_path": pr.field_path,
            "edited": edited,
            "content_hash": new_hash,
            "revision": version.revision,
        },
        request=request,
    )
    return version


def reject(
    db: Session,
    p: Principal,
    pr: ChangeProposal,
    *,
    note: str | None = None,
    request: Request | None = None,
) -> None:
    if pr.status not in ("pending", "stale"):
        raise ApiError(409, f"proposal_{pr.status}", "Решение по предложению уже принято")
    pr.status = "rejected"
    pr.decided_by_id = p.user.id
    pr.decided_at = datetime.now(UTC)
    pr.decision_note = (note or "").strip() or None
    version = db.get(PersonaVersion, pr.version_id)
    audit.record(
        db,
        actor_id=p.user.id,
        action="persona.proposal_reject",
        entity_type="persona_version",
        entity_id=pr.version_id,
        entity_version=version.label if version else None,
        details={"proposal_id": str(pr.id), "field_path": pr.field_path},
        request=request,
    )
