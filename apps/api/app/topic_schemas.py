"""DTO API тем (итерация 3)."""

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas import UserRef
from app.topic_dossier import Dossier


class TopicVersionRef(BaseModel):
    id: UUID
    label: str
    state: str
    content_hash: str
    revision: int


class TopicCounts(BaseModel):
    claims: int
    verified: int
    unsafe: int  # опровергнутые, спорные, устаревшие или с пометкой
    open_questions: int


class TopicListItem(BaseModel):
    id: UUID
    title: str
    geography: str
    category: str
    status: str
    creation_mode: str
    active_version: TopicVersionRef | None
    draft_version: TopicVersionRef | None
    counts: TopicCounts | None
    created_by: UserRef | None
    created_at: datetime
    updated_at: datetime


class TopicCapabilities(BaseModel):
    can_edit: bool
    can_submit: bool
    can_activate: bool
    can_archive: bool
    can_flag: bool
    can_verify_claims: bool


class TopicVersionSummary(BaseModel):
    id: UUID
    label: str
    state: str
    content_hash: str
    change_note: str
    created_by: UserRef | None
    approved_by: UserRef | None
    created_at: datetime
    approved_at: datetime | None


class ClaimFlagOut(BaseModel):
    id: UUID
    claim_id: UUID
    version_id: UUID
    flag: str
    reason: str
    origin: str
    created_by: UserRef | None
    created_at: datetime


class TopicDetail(TopicListItem):
    versions: list[TopicVersionSummary]
    capabilities: TopicCapabilities
    flags: list[ClaimFlagOut]  # текущие действующие пометки по утверждениям активной версии


class EffectiveClaim(BaseModel):
    id: UUID
    effective_status: str
    safe_to_use: bool
    flag: ClaimFlagOut | None


class TopicVersionDetail(TopicVersionSummary):
    topic_id: UUID
    revision: int
    schema_version: int
    dossier: Dossier
    claims_effective: list[EffectiveClaim]
    updated_by: UserRef | None
    updated_at: datetime


class TopicCreate(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    geography: str = Field(default="", max_length=300)
    category: str = Field(default="", max_length=100)
    summary: str = Field(default="", max_length=8000)


class TopicPatch(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=300)
    geography: str | None = Field(default=None, max_length=300)
    category: str | None = Field(default=None, max_length=100)


class TopicVersionUpdate(BaseModel):
    dossier: Dossier
    expected_revision: int
    change_note: str | None = Field(default=None, max_length=2000)


class TopicVersionIn(BaseModel):
    version_id: UUID


class TopicSuspendIn(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class ClaimFlagIn(BaseModel):
    claim_id: UUID
    flag: Literal["refuted", "disputed", "stale", "cleared"]
    reason: str = Field(min_length=3, max_length=2000)


class ClaimHistoryEntry(BaseModel):
    kind: Literal["version", "flag"]
    at: datetime
    version_label: str | None
    version_state: str | None
    text: str | None
    status: str | None
    valid_until: date | None
    flag: str | None
    reason: str | None
    actor: UserRef | None


class Blocker(BaseModel):
    code: str
    message: str


class ActivationCheck(BaseModel):
    version_id: UUID
    content_hash: str
    blockers: list[Blocker]
    warnings: list[Blocker]
    details: dict[str, Any] = Field(default_factory=dict)
