from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, or_, select

from app import audit
from app.activation import activation_blockers
from app.deps import DB, CurrentUser, Principal
from app.errors import ApiError, forbidden, not_found
from app.integrations.llm import llm_status
from app.models import AuditEvent, Persona, PersonaSourceMaterial, PersonaVersion, User
from app.passport import Passport, completeness, schema_document
from app.rbac import Perm
from app.routers.system import audit_out
from app.schemas import (
    ActivateIn,
    AuditOut,
    CompletenessOut,
    Page,
    PersonaCapabilities,
    PersonaCreate,
    PersonaDetail,
    PersonaListItem,
    PersonaPatch,
    SourceMaterialOut,
    UserRef,
    VersionDetail,
    VersionRef,
    VersionSummary,
    VersionUpdate,
)
from app.services import personas as svc

router = APIRouter(prefix="/personas", tags=["personas"])


def _ref(u: User | None) -> UserRef | None:
    return UserRef(id=u.id, display_name=u.display_name) if u else None


def _vref(v: PersonaVersion | None) -> VersionRef | None:
    if v is None:
        return None
    return VersionRef(
        id=v.id, label=v.label, state=v.state, content_hash=v.content_hash, revision=v.revision
    )


def _list_item(persona: Persona, p: Principal) -> PersonaListItem:
    versions = {v.id: v for v in persona.versions}
    active = versions.get(persona.active_version_id) if persona.active_version_id else None
    draft = next((v for v in persona.versions if v.state == "draft"), None)
    if not p.has(Perm.PERSONA_READ_ALL):
        draft = None
    basis = draft or active
    comp = None
    if basis is not None:
        c = completeness(Passport.model_validate(basis.passport))
        comp = CompletenessOut(fields_filled=c["fields_filled"], fields_total=c["fields_total"])
    return PersonaListItem(
        id=persona.id,
        display_name=persona.display_name,
        short_context=persona.short_context,
        status=persona.status,
        creation_mode=persona.creation_mode,
        is_seed=persona.is_seed,
        created_by=_ref(persona.created_by),
        created_at=persona.created_at,
        updated_at=persona.updated_at,
        active_version=_vref(active),
        draft_version=_vref(draft),
        completeness=comp,
        open_issues=None,
    )


def _summary(v: PersonaVersion) -> VersionSummary:
    return VersionSummary(
        id=v.id,
        label=v.label,
        state=v.state,
        content_hash=v.content_hash,
        revision=v.revision,
        created_at=v.created_at,
        updated_at=v.updated_at,
        created_by=_ref(v.created_by),
        approved_at=v.approved_at,
    )


def _detail(db: DB, persona: Persona, p: Principal) -> PersonaDetail:
    item = _list_item(persona, p)
    versions = persona.versions
    if not p.has(Perm.PERSONA_READ_ALL):
        versions = [v for v in versions if v.state == "active"]
    materials = (
        db.scalars(
            select(PersonaSourceMaterial)
            .where(PersonaSourceMaterial.persona_id == persona.id)
            .order_by(PersonaSourceMaterial.created_at)
        ).all()
        if p.has(Perm.PERSONA_READ_ALL)
        else []
    )
    archived = persona.status == "archived"
    has_draft = item.draft_version is not None
    return PersonaDetail(
        **item.model_dump(),
        versions=[_summary(v) for v in versions],
        source_materials=[SourceMaterialOut.model_validate(m) for m in materials],
        capabilities=PersonaCapabilities(
            can_edit=p.has(Perm.PERSONA_EDIT) and not archived and has_draft,
            can_archive=p.has(Perm.PERSONA_ARCHIVE),
            can_activate=p.has(Perm.PERSONA_ACTIVATE) and not archived and has_draft,
            can_create_version=p.has(Perm.PERSONA_EDIT)
            and not archived
            and not has_draft
            and persona.active_version_id is not None,
        ),
    )


@router.get("/schema")
def get_schema(_: CurrentUser) -> dict:
    return schema_document()


@router.get("", response_model=Page[PersonaListItem])
def list_personas(
    db: DB,
    p: CurrentUser,
    q: str | None = Query(default=None, max_length=200),
    status: Annotated[list[str] | None, Query()] = None,
    include_archived: bool = False,
    sort: Literal["updated_desc", "name_asc", "created_desc"] = "updated_desc",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> Page[PersonaListItem]:
    if not (p.has(Perm.PERSONA_READ_ALL) or p.has(Perm.PERSONA_READ_ACTIVE)):
        raise forbidden()
    stmt = select(Persona)
    if not p.has(Perm.PERSONA_READ_ALL):
        stmt = stmt.where(Persona.active_version_id.is_not(None))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Persona.display_name.ilike(like), Persona.short_context.ilike(like)))
    if status:
        stmt = stmt.where(Persona.status.in_(status))
    elif not include_archived:
        stmt = stmt.where(Persona.status != "archived")
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order: Any = {
        "updated_desc": Persona.updated_at.desc(),
        "name_asc": Persona.display_name.asc(),
        "created_desc": Persona.created_at.desc(),
    }[sort]
    rows = db.scalars(
        stmt.order_by(order, Persona.id).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return Page(items=[_list_item(r, p) for r in rows], total=total, page=page, page_size=page_size)


@router.post("", response_model=PersonaDetail, status_code=201)
def create_persona(body: PersonaCreate, db: DB, p: CurrentUser, request: Request) -> PersonaDetail:
    p.require(Perm.PERSONA_CREATE)
    if body.mode == "ai_draft":
        st = llm_status()
        if st["status"] != "configured":
            raise ApiError(
                503,
                "llm_not_configured",
                "LLM-провайдер не подключён: ИИ-черновик недоступен. "
                "Создайте личность вручную или из легенды.",
            )
        raise ApiError(
            501,
            "not_implemented",
            "Генерация ИИ-черновика паспорта появится в итерации 2 (очередь предложений).",
        )
    persona = svc.create_persona(
        db,
        p,
        display_name=body.display_name,
        short_context=body.short_context,
        mode=body.mode,
        legend_text=body.legend_text,
        request=request,
    )
    db.commit()
    db.refresh(persona)
    return _detail(db, persona, p)


@router.get("/{persona_id}", response_model=PersonaDetail)
def get_persona(persona_id: UUID, db: DB, p: CurrentUser) -> PersonaDetail:
    return _detail(db, svc.visible_persona(db, p, persona_id), p)


@router.patch("/{persona_id}", response_model=PersonaDetail)
def patch_persona(
    persona_id: UUID, body: PersonaPatch, db: DB, p: CurrentUser, request: Request
) -> PersonaDetail:
    p.require(Perm.PERSONA_EDIT)
    persona = svc.visible_persona(db, p, persona_id)
    if persona.status == "archived":
        raise ApiError(409, "persona_archived", "Личность в архиве")
    if body.short_context is not None and body.short_context != persona.short_context:
        persona.short_context = body.short_context.strip()
        audit.record(
            db,
            actor_id=p.user.id,
            action="persona.edit_meta",
            entity_type="persona",
            entity_id=persona.id,
            details={"fields": ["short_context"]},
            request=request,
        )
    db.commit()
    db.refresh(persona)
    return _detail(db, persona, p)


@router.post("/{persona_id}/archive", response_model=PersonaDetail)
def archive_persona(persona_id: UUID, db: DB, p: CurrentUser, request: Request) -> PersonaDetail:
    p.require(Perm.PERSONA_ARCHIVE)
    persona = svc.visible_persona(db, p, persona_id)
    svc.archive(db, p, persona, request)
    db.commit()
    db.refresh(persona)
    return _detail(db, persona, p)


@router.post("/{persona_id}/unarchive", response_model=PersonaDetail)
def unarchive_persona(persona_id: UUID, db: DB, p: CurrentUser, request: Request) -> PersonaDetail:
    p.require(Perm.PERSONA_ARCHIVE)
    persona = svc.visible_persona(db, p, persona_id)
    svc.unarchive(db, p, persona, request)
    db.commit()
    db.refresh(persona)
    return _detail(db, persona, p)


@router.get("/{persona_id}/versions/{version_id}", response_model=VersionDetail)
def get_version(persona_id: UUID, version_id: UUID, db: DB, p: CurrentUser) -> VersionDetail:
    persona = svc.visible_persona(db, p, persona_id)
    v = svc.visible_version(db, p, persona, version_id)
    return VersionDetail(
        **_summary(v).model_dump(),
        persona_id=persona.id,
        schema_version=v.schema_version,
        passport=v.passport,
        completeness=completeness(Passport.model_validate(v.passport)),
        updated_by=_ref(v.updated_by),
    )


@router.put("/{persona_id}/versions/{version_id}", response_model=VersionDetail)
def update_version(
    persona_id: UUID,
    version_id: UUID,
    body: VersionUpdate,
    db: DB,
    p: CurrentUser,
    request: Request,
) -> VersionDetail:
    p.require(Perm.PERSONA_EDIT)
    persona = svc.visible_persona(db, p, persona_id)
    v = svc.visible_version(db, p, persona, version_id)
    svc.update_draft(db, p, persona, v, body.passport, body.expected_revision, request)
    db.commit()
    return get_version(persona_id, version_id, db, p)


@router.post("/{persona_id}/versions", response_model=VersionDetail, status_code=201)
def create_version(persona_id: UUID, db: DB, p: CurrentUser, request: Request) -> VersionDetail:
    p.require(Perm.PERSONA_EDIT)
    persona = svc.visible_persona(db, p, persona_id)
    draft = svc.new_draft_from_latest(db, p, persona, request)
    db.commit()
    return get_version(persona_id, draft.id, db, p)


@router.get("/{persona_id}/activation-check")
def activation_check(persona_id: UUID, version_id: UUID, db: DB, p: CurrentUser) -> dict:
    persona = svc.visible_persona(db, p, persona_id)
    v = svc.visible_version(db, p, persona, version_id)
    blockers = activation_blockers(db, v)
    return {
        "version_id": str(v.id),
        "content_hash": v.content_hash,
        "can_activate_by_role": p.has(Perm.PERSONA_ACTIVATE),
        "blockers": [b.__dict__ for b in blockers],
    }


@router.post("/{persona_id}/activate")
def activate(persona_id: UUID, body: ActivateIn, db: DB, p: CurrentUser, request: Request) -> dict:
    # Сначала права: admin без роли editor и operator получают 403 даже при прямом вызове.
    p.require(Perm.PERSONA_ACTIVATE)
    persona = svc.visible_persona(db, p, persona_id)
    v = db.get(PersonaVersion, body.version_id)
    if v is None or v.persona_id != persona.id:
        raise not_found("Версия")
    blockers = activation_blockers(db, v)
    audit.record(
        db,
        actor_id=p.user.id,
        action="persona.activate_rejected" if blockers else "persona.activate",
        entity_type="persona_version",
        entity_id=v.id,
        entity_version=v.label,
        details={"content_hash": v.content_hash, "blockers": [b.code for b in blockers]},
        request=request,
    )
    db.commit()
    if blockers:
        raise ApiError(
            409,
            "activation_blocked",
            "Активация заблокирована: устраните блокирующие условия",
            [b.__dict__ for b in blockers],
        )
    # Недостижимо в итерации 1 — барьер всегда содержит отсутствующие проверки.
    raise ApiError(500, "unreachable", "Активация без проверок невозможна")


@router.get("/{persona_id}/history", response_model=list[AuditOut])
def persona_history(persona_id: UUID, db: DB, p: CurrentUser) -> list[AuditOut]:
    """Журнал действий по персоне и её версиям (для вкладки «Версии и история»)."""
    p.require(Perm.PERSONA_READ_ALL)
    persona = svc.visible_persona(db, p, persona_id)
    ids = [str(persona.id)] + [str(v.id) for v in persona.versions]
    rows = db.scalars(
        select(AuditEvent)
        .where(AuditEvent.entity_id.in_(ids))
        .order_by(AuditEvent.occurred_at.desc())
        .limit(200)
    ).all()
    return [audit_out(e) for e in rows]
