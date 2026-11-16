from typing import Any
from uuid import UUID

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditEvent


def record(
    db: Session,
    *,
    actor_id: UUID | None,
    action: str,
    entity_type: str,
    entity_id: Any = None,
    entity_version: str | None = None,
    details: dict[str, Any] | None = None,
    request: Request | None = None,
) -> AuditEvent:
    """Добавляет событие аудита в текущую транзакцию (коммитится вместе с действием)."""
    ev = AuditEvent(
        actor_user_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        entity_version=entity_version,
        details=details or {},
        request_id=getattr(request.state, "request_id", None) if request else None,
    )
    db.add(ev)
    return ev
