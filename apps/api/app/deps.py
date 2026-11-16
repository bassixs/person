from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.errors import ApiError, forbidden
from app.models import User, UserSession
from app.rbac import Perm, permissions_for
from app.security import token_digest

DB = Annotated[Session, Depends(get_db)]

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@dataclass
class Principal:
    user: User
    session: UserSession
    roles: set[str]
    perms: set[Perm]

    def has(self, perm: Perm) -> bool:
        return perm in self.perms

    def require(self, perm: Perm) -> None:
        if perm not in self.perms:
            raise forbidden()


def get_principal(request: Request, db: DB) -> Principal:
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise ApiError(401, "unauthenticated", "Требуется вход в систему")
    sess = db.scalar(select(UserSession).where(UserSession.token_hash == token_digest(token)))
    now = datetime.now(UTC)
    if sess is None or sess.revoked_at is not None or sess.expires_at <= now:
        raise ApiError(401, "session_expired", "Сессия истекла, войдите снова")
    if not sess.user.is_active:
        raise ApiError(401, "user_disabled", "Учётная запись отключена")
    # CSRF: double-submit — заголовок должен совпасть с токеном сессии.
    if request.method not in SAFE_METHODS:
        header = request.headers.get("X-CSRF-Token")
        if not header or header != sess.csrf_token:
            raise ApiError(403, "csrf_failed", "Проверка CSRF не пройдена, обновите страницу")
    roles = sess.user.roles
    request.state.user_id = str(sess.user.id)
    return Principal(user=sess.user, session=sess, roles=roles, perms=permissions_for(roles))


CurrentUser = Annotated[Principal, Depends(get_principal)]


def require(perm: Perm):
    def _dep(p: CurrentUser) -> Principal:
        p.require(perm)
        return p

    return Depends(_dep)
