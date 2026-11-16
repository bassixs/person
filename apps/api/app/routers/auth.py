from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request, Response
from sqlalchemy import func, select

from app import audit
from app.config import get_settings
from app.deps import DB, CurrentUser, Principal
from app.errors import ApiError
from app.models import User, UserSession
from app.rbac import permissions_for
from app.schemas import LoginIn, MeOut
from app.security import login_limiter, new_token, token_digest, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _me(user: User, csrf: str) -> MeOut:
    roles = sorted(user.roles)
    return MeOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        roles=roles,
        permissions=sorted(p.value for p in permissions_for(set(roles))),
        csrf_token=csrf,
    )


@router.post("/login", response_model=MeOut)
def login(body: LoginIn, request: Request, response: Response, db: DB) -> MeOut:
    s = get_settings()
    email = body.email.lower()
    key = f"{request.client.host if request.client else '-'}|{email}"
    if not login_limiter.check_and_hit(key, s.login_max_attempts, s.login_window_seconds):
        raise ApiError(429, "too_many_attempts", "Слишком много попыток входа, попробуйте позже")
    user = db.scalar(select(User).where(func.lower(User.email) == email))
    ok = verify_password(user.password_hash if user else None, body.password)
    if not ok or user is None or not user.is_active:
        audit.record(
            db,
            actor_id=user.id if user else None,
            action="auth.login_failed",
            entity_type="user",
            entity_id=user.id if user else None,
            request=request,
        )
        db.commit()
        raise ApiError(401, "invalid_credentials", "Неверный email или пароль")
    login_limiter.reset(key)
    token, csrf = new_token(), new_token()
    db.add(
        UserSession(
            token_hash=token_digest(token),
            csrf_token=csrf,
            user_id=user.id,
            expires_at=datetime.now(UTC) + timedelta(hours=s.session_ttl_hours),
        )
    )
    audit.record(
        db,
        actor_id=user.id,
        action="auth.login",
        entity_type="user",
        entity_id=user.id,
        request=request,
    )
    db.commit()
    max_age = s.session_ttl_hours * 3600
    response.set_cookie(
        s.session_cookie_name,
        token,
        max_age=max_age,
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        s.csrf_cookie_name,
        csrf,
        max_age=max_age,
        httponly=False,
        secure=s.cookie_secure,
        samesite="lax",
        path="/",
    )
    return _me(user, csrf)


@router.post("/logout", status_code=204)
def logout(p: CurrentUser, request: Request, response: Response, db: DB) -> None:
    s = get_settings()
    p.session.revoked_at = datetime.now(UTC)
    audit.record(
        db,
        actor_id=p.user.id,
        action="auth.logout",
        entity_type="user",
        entity_id=p.user.id,
        request=request,
    )
    db.commit()
    response.delete_cookie(s.session_cookie_name, path="/")
    response.delete_cookie(s.csrf_cookie_name, path="/")


@router.get("/me", response_model=MeOut)
def me(p: CurrentUser) -> MeOut:
    return _me(p.user, p.session.csrf_token)


def principal_me(p: Principal) -> MeOut:
    return _me(p.user, p.session.csrf_token)
