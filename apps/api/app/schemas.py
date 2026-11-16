from datetime import datetime
from typing import Annotated, Any, Generic, Literal, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.models import ROLE_CODES
from app.passport import Passport

T = TypeVar("T")

# Внутренние учётки могут жить на служебных доменах (.local, .test, корпоративные зоны),
# которые строгая проверка email-validator отвергает. Проверяем только форму адреса.
Email = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"),
]


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class UserRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_name: str


# ---------- auth / users ----------


class LoginIn(BaseModel):
    email: Email
    password: str = Field(min_length=1, max_length=512)


class MeOut(BaseModel):
    id: UUID
    email: str
    display_name: str
    roles: list[str]
    permissions: list[str]
    csrf_token: str


class UserOut(BaseModel):
    id: UUID
    email: str
    display_name: str
    roles: list[str]
    is_active: bool
    created_at: datetime


def _check_roles(v: list[str]) -> list[str]:
    bad = [r for r in v if r not in ROLE_CODES]
    if bad:
        raise ValueError(f"Неизвестные роли: {', '.join(bad)}")
    return sorted(set(v))


class UserCreate(BaseModel):
    email: Email
    display_name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=10, max_length=512)
    roles: list[str] = Field(default_factory=list)

    @field_validator("roles")
    @classmethod
    def _r(cls, v: list[str]) -> list[str]:
        return _check_roles(v)


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    roles: list[str] | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=10, max_length=512)

    @field_validator("roles")
    @classmethod
    def _r(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else _check_roles(v)


# ---------- personas ----------


class VersionRef(BaseModel):
    id: UUID
    label: str
    state: str
    content_hash: str
    revision: int


class CompletenessOut(BaseModel):
    fields_filled: int
    fields_total: int


class PersonaListItem(BaseModel):
    id: UUID
    display_name: str
    short_context: str
    status: str
    creation_mode: str
    is_seed: bool
    created_by: UserRef | None
    created_at: datetime
    updated_at: datetime
    active_version: VersionRef | None
    draft_version: VersionRef | None
    completeness: CompletenessOut | None
    # Итерация 1: проверки ещё не запускаются; None = «проверка не запускалась», а не 0 замечаний.
    open_issues: int | None = None


class PersonaCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=200)
    short_context: str = Field(default="", max_length=2000)
    mode: Literal["manual", "legend", "ai_draft"] = "manual"
    legend_text: str | None = Field(default=None, max_length=20000)


class PersonaPatch(BaseModel):
    short_context: str | None = Field(default=None, max_length=2000)


class SourceMaterialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    kind: str
    content: str
    created_at: datetime


class VersionSummary(BaseModel):
    id: UUID
    label: str
    state: str
    content_hash: str
    revision: int
    created_at: datetime
    updated_at: datetime
    created_by: UserRef | None
    approved_at: datetime | None


class PersonaCapabilities(BaseModel):
    can_edit: bool
    can_archive: bool
    can_activate: bool
    can_create_version: bool


class PersonaDetail(PersonaListItem):
    versions: list[VersionSummary]
    source_materials: list[SourceMaterialOut]
    capabilities: PersonaCapabilities


class VersionDetail(VersionSummary):
    persona_id: UUID
    schema_version: int
    passport: dict[str, Any]
    completeness: dict[str, Any]
    updated_by: UserRef | None


class VersionUpdate(BaseModel):
    passport: Passport
    expected_revision: int = Field(ge=1)


class ActivateIn(BaseModel):
    version_id: UUID


class AuditOut(BaseModel):
    id: UUID
    occurred_at: datetime
    actor: UserRef | None
    action: str
    entity_type: str
    entity_id: str | None
    entity_version: str | None
    details: dict[str, Any]
