"""ORM-модели итерации 1: пользователи/роли/сессии/аудит + персоны и версии паспортов.

Инварианты, которые нельзя обойти даже прямым SQL, продублированы триггерами в миграции:
- persona_versions: содержимое не-draft версии неизменяемо;
- persona_source_materials: исходная легенда неизменяема и не удаляется.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

ROLE_CODES = ("admin", "editor", "author", "operator")

PERSONA_STATUSES = (
    "draft",
    "pending_approval",
    "active",
    "needs_revision",
    "suspended",
    "archived",
)
VERSION_STATES = ("draft", "active", "superseded", "suspended")


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Role(Base):
    __tablename__ = "roles"
    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    title: Mapped[str] = mapped_column(String(128), nullable=False)


class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    role_links: Mapped[list["UserRole"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def roles(self) -> set[str]:
        return {link.role_code for link in self.role_links}


class UserRole(Base):
    __tablename__ = "user_roles"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role_code: Mapped[str] = mapped_column(String(32), ForeignKey("roles.code"), primary_key=True)


class UserSession(Base):
    __tablename__ = "user_sessions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    csrf_token: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user: Mapped[User] = relationship(lazy="joined")


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(64), index=True)
    entity_version: Mapped[str | None] = mapped_column(String(32))
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    request_id: Mapped[str | None] = mapped_column(String(64))
    actor: Mapped[User | None] = relationship(lazy="joined")


class Persona(TimestampMixin, Base):
    __tablename__ = "personas"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft','pending_approval','active',"
            "'needs_revision','suspended','archived')",
            name="status_valid",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    short_context: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="draft", nullable=False, index=True)
    status_before_archive: Mapped[str | None] = mapped_column(String(32))
    creation_mode: Mapped[str] = mapped_column(String(32), default="manual", nullable=False)
    is_seed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    active_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("persona_versions.id", use_alter=True, name="fk_personas_active_version"),
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_by: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[created_by_id])
    versions: Mapped[list["PersonaVersion"]] = relationship(
        back_populates="persona",
        foreign_keys="PersonaVersion.persona_id",
        order_by="(PersonaVersion.version_major, PersonaVersion.version_minor)",
    )


class PersonaVersion(Base):
    __tablename__ = "persona_versions"
    __table_args__ = (
        UniqueConstraint("persona_id", "version_major", "version_minor", name="uq_persona_version"),
        CheckConstraint("state IN ('draft','active','superseded','suspended')", name="state_valid"),
        Index(
            "uq_persona_one_draft",
            "persona_id",
            unique=True,
            postgresql_where=text("state = 'draft'"),
        ),
        Index(
            "uq_persona_one_active",
            "persona_id",
            unique=True,
            postgresql_where=text("state = 'active'"),
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    persona_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("personas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_major: Mapped[int] = mapped_column(Integer, nullable=False)
    version_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    state: Mapped[str] = mapped_column(String(16), default="draft", nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    passport: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    based_on_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("persona_versions.id")
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    persona: Mapped[Persona] = relationship(back_populates="versions", foreign_keys=[persona_id])
    created_by: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[created_by_id])
    updated_by: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[updated_by_id])

    @property
    def label(self) -> str:
        return f"{self.version_major}.{self.version_minor}"


class PersonaSourceMaterial(Base):
    """Исходный материал (например, стартовая легенда). Неизменяем."""

    __tablename__ = "persona_source_materials"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    persona_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("personas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)  # original_legend
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


# ---------------------------------------------------------------------------
# Итерация 2: интервью, очередь предложений ИИ, учёт вызовов ИИ
# ---------------------------------------------------------------------------


class InterviewSession(Base):
    """ИИ-интервью по черновику: адаптивные раунды по 3–5 вопросов (ТЗ §3)."""

    __tablename__ = "persona_interview_sessions"
    __table_args__ = (
        CheckConstraint("status IN ('active','completed')", name="interview_status_valid"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    persona_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("personas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("persona_versions.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    rounds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_by: Mapped[User | None] = relationship(lazy="joined")
    questions: Mapped[list["InterviewAnswer"]] = relationship(
        order_by="(InterviewAnswer.round_no, InterviewAnswer.position)",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class InterviewAnswer(Base):
    """Вопрос интервью и ответ редактора: уточнение внутренней модели, не «реальная биография»."""

    __tablename__ = "persona_interview_answers"
    __table_args__ = (
        CheckConstraint(
            "answer_kind IS NULL OR answer_kind IN ('answered','unknown','skipped')",
            name="answer_kind_valid",
        ),
        UniqueConstraint("session_id", "round_no", "position", name="uq_interview_question"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("persona_interview_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    round_no: Mapped[int] = mapped_column(Integer, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    why: Mapped[str] = mapped_column(Text, default="", nullable=False)
    field_paths: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    answer_kind: Mapped[str | None] = mapped_column(String(16))
    answer_text: Mapped[str | None] = mapped_column(Text)
    answered_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ChangeProposal(Base):
    """Предложение ИИ по одному полю или нарративу черновика.

    Исходное предложение (proposed_*) неизменно; правка редактора хранится отдельно (edited_*).
    В паспорт попадает только через accept: сервер, optimistic lock, аудит.
    """

    __tablename__ = "persona_change_proposals"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','accepted','rejected','stale')", name="proposal_status_valid"
        ),
        CheckConstraint(
            "proposed_certainty IN ('defined','hypothesis')", name="proposal_certainty_valid"
        ),
        Index("ix_proposals_version_status", "version_id", "status"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    persona_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("personas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("persona_versions.id", ondelete="CASCADE"), nullable=False
    )
    origin: Mapped[str] = mapped_column(String(32), nullable=False)  # interview | deepen
    interview_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("persona_interview_sessions.id", ondelete="SET NULL")
    )
    # section.field или section.narrative
    field_path: Mapped[str] = mapped_column(String(64), nullable=False)
    before_value: Mapped[Any] = mapped_column(JSONB, nullable=True)
    proposed_value: Mapped[Any] = mapped_column(JSONB, nullable=False)
    proposed_certainty: Mapped[str] = mapped_column(String(16), nullable=False)
    rationale: Mapped[str] = mapped_column(Text, default="", nullable=False)
    related_paths: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    base_content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    edited_value: Mapped[Any] = mapped_column(JSONB, nullable=True)
    edited_certainty: Mapped[str | None] = mapped_column(String(16))
    decision_note: Mapped[str | None] = mapped_column(Text)
    stale_reason: Mapped[str | None] = mapped_column(Text)
    generator: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_by: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[created_by_id])
    decided_by: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[decided_by_id])


class AiRun(Base):
    """Трасса вызова ИИ: навык, модель, статус, токены, задержка, ошибка (учёт расхода, ТЗ §6)."""

    __tablename__ = "ai_runs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    skill: Mapped[str] = mapped_column(String(64), nullable=False)
    skill_version: Mapped[str] = mapped_column(String(16), nullable=False)
    model: Mapped[str | None] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(16), nullable=False)  # ok | error
    entity_type: Mapped[str | None] = mapped_column(String(64))
    entity_id: Mapped[str | None] = mapped_column(String(64), index=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer)
    completion_tokens: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    attempts: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    cost_rub: Mapped[float | None] = mapped_column()


# ---------------------------------------------------------------------------
# Итерация 2: проверка целостности паспорта и «светофор» согласованности
# ---------------------------------------------------------------------------


class ValidationRun(Base):
    """Полная проверка паспорта ИИ. Действительна только для своего content_hash (ТЗ §3)."""

    __tablename__ = "persona_validation_runs"
    __table_args__ = (
        CheckConstraint("kind IN ('check','final')", name="validation_kind_valid"),
        CheckConstraint(
            "status IN ('queued','running','done','failed')", name="validation_status_valid"
        ),
        Index("ix_validation_version_hash", "version_id", "content_hash"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    persona_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("personas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("persona_versions.id", ondelete="CASCADE"), nullable=False
    )
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # check | final
    status: Mapped[str] = mapped_column(String(16), default="queued", nullable=False)
    model: Mapped[str | None] = mapped_column(String(128))
    summary: Mapped[str | None] = mapped_column(Text)
    critical_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    warning_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    info_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    started_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    started_by: Mapped[User | None] = relationship(lazy="joined")
    issues: Mapped[list["ValidationIssue"]] = relationship(
        order_by="(ValidationIssue.severity_rank, ValidationIssue.position)",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class ValidationIssue(Base):
    """Замечание проверки: проблема, поля, серьёзность, аргументация, предложенное исправление."""

    __tablename__ = "persona_validation_issues"
    __table_args__ = (
        CheckConstraint("severity IN ('critical','warning','info')", name="issue_severity_valid"),
        CheckConstraint(
            "kind IN ('contradiction','unspecified','unusual_compatible')",
            name="issue_kind_valid",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("persona_validation_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    severity_rank: Mapped[int] = mapped_column(Integer, nullable=False)  # 0 critical … 2 info
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    field_paths: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    suggestion: Mapped[str | None] = mapped_column(Text)
    fix_field_path: Mapped[str | None] = mapped_column(String(64))
    fix_value: Mapped[Any] = mapped_column(JSONB, nullable=True)
    proposal_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("persona_change_proposals.id", ondelete="SET NULL")
    )


class ConsistencySignal(Base):
    """«Светофор» согласованности: быстрый вероятностный ответ Decisions API для content_hash.

    Это подсказка, а не проверка: барьер активации опирается только на ValidationRun(final).
    """

    __tablename__ = "persona_consistency_signals"
    __table_args__ = (
        CheckConstraint(
            "level IN ('green','yellow','red','unavailable','error')", name="signal_level_valid"
        ),
        Index("ix_signal_version_hash", "version_id", "content_hash"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("persona_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    level: Mapped[str] = mapped_column(String(16), nullable=False)
    p_conflict: Mapped[float | None] = mapped_column()
    severity: Mapped[str | None] = mapped_column(String(16))
    model: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
