"""Досье темы (PROJECT_CONTEXT §8.3–8.5, §9.4) — единственный источник схемы для API и UI.

Тема — реальное событие или вопрос; меняется часто, но активная версия неизменна.
Утверждения (claims) живут внутри версии досье со стабильным `id`, поэтому:
- содержимое версии и её content_hash покрывают и факты
  (проверки и задания ссылаются на точную версию);
- история значения утверждения восстанавливается по версиям;
- срочная пометка «не использовать как подтверждённое» для утверждения активной версии хранится
  отдельно (topic_claim_flags) и не требует переписывать неизменяемую версию.

Понимание ИИ не равно проверке достоверности: статус `verified` ставит только редактор и только при
наличии источника. Гипотеза не становится фактом одним ответом модели.
"""

import hashlib
import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.passport import canonical_json

DOSSIER_SCHEMA_VERSION = 1

ClaimStatus = Literal["unverified", "verified", "disputed", "refuted", "stale"]
CLAIM_STATUSES: tuple[str, ...] = ("unverified", "verified", "disputed", "refuted", "stale")
# Статусы, которые может выставить только редактор (утверждение достоверности / опровержение).
EDITOR_ONLY_STATUSES = {"verified", "refuted"}
ClaimKind = Literal["operational", "stable"]
ClaimOrigin = Literal["editor", "ai_suggestion", "monitoring", "task"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ClaimSource(_Strict):
    title: str = Field(default="", max_length=500)
    url: str | None = Field(default=None, max_length=2000)
    quote: str | None = Field(default=None, max_length=4000)
    location: str | None = Field(default=None, max_length=200)  # страница, абзац, время ролика
    knowledge_item_id: uuid.UUID | None = None

    @field_validator("url")
    @classmethod
    def _url(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        v = v.strip()
        if not v.lower().startswith(("http://", "https://")):
            raise ValueError("Ссылка должна начинаться с http:// или https://")
        return v

    @property
    def is_concrete(self) -> bool:
        return bool(self.url or self.knowledge_item_id)


class Claim(_Strict):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    text: str = Field(min_length=3, max_length=2000)
    status: ClaimStatus = "unverified"
    kind: ClaimKind = "stable"  # operational — оперативное, с коротким сроком пересмотра
    event_date: str | None = Field(default=None, max_length=100)  # «25 ноября», «весна 2027»
    published_at: date | None = None
    checked_at: date | None = None
    valid_from: date | None = None
    valid_until: date | None = None
    sources: list[ClaimSource] = Field(default_factory=list, max_length=20)
    origin: ClaimOrigin = "editor"
    note: str = Field(default="", max_length=2000)


class FaqItem(_Strict):
    question: str = Field(min_length=1, max_length=1000)
    answer: str = Field(default="", max_length=4000)


class Dossier(_Strict):
    summary: str = Field(default="", max_length=8000)
    background: str = Field(default="", max_length=20000)
    territory: str = Field(default="", max_length=1000)
    timeframe: str = Field(default="", max_length=500)
    participants: list[str] = Field(default_factory=list, max_length=100)
    claims: list[Claim] = Field(default_factory=list, max_length=500)
    residents_questions: list[str] = Field(default_factory=list, max_length=200)
    faq: list[FaqItem] = Field(default_factory=list, max_length=200)
    unknowns: list[str] = Field(default_factory=list, max_length=200)
    conflicts: list[str] = Field(default_factory=list, max_length=200)

    @field_validator("participants", "residents_questions", "unknowns", "conflicts")
    @classmethod
    def _clean_list(cls, v: list[str]) -> list[str]:
        out = [s.strip() for s in v if s and s.strip()]
        for s in out:
            if len(s) > 2000:
                raise ValueError("Элемент списка длиннее 2000 символов")
        return out

    @field_validator("claims")
    @classmethod
    def _unique_ids(cls, v: list[Claim]) -> list[Claim]:
        ids = [c.id for c in v]
        if len(ids) != len(set(ids)):
            raise ValueError("Идентификаторы утверждений повторяются")
        return v


def empty_dossier(summary: str = "") -> Dossier:
    return Dossier(summary=summary.strip())


def dossier_hash(d: Dossier) -> str:
    return hashlib.sha256(canonical_json(d.model_dump(mode="json")).encode()).hexdigest()


def effective_status(claim: Claim, today: date, flag: str | None = None) -> str:
    """Статус для использования в ответах: срочная пометка и истёкший срок важнее сохранённого."""
    if flag in ("refuted", "disputed", "stale"):
        return flag
    if claim.status == "verified" and claim.valid_until is not None and claim.valid_until < today:
        return "stale"
    return claim.status


def safe_to_use(status: str) -> bool:
    """Подтверждённым можно называть только verified (без пометки и не просроченное)."""
    return status == "verified"


def schema_document() -> dict:
    return {
        "schema_version": DOSSIER_SCHEMA_VERSION,
        "claim_statuses": {
            "unverified": "не проверено",
            "verified": "подтверждено",
            "disputed": "спорно",
            "refuted": "опровергнуто",
            "stale": "устарело",
        },
        "editor_only_statuses": sorted(EDITOR_ONLY_STATUSES),
        "claim_kinds": {"operational": "оперативное", "stable": "устойчивое"},
        "json_schema": Dossier.model_json_schema(),
    }
