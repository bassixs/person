from uuid import UUID

from fastapi import APIRouter, Request
from sqlalchemy import func, select

from app import audit
from app.deps import DB, CurrentUser
from app.errors import ApiError, not_found
from app.models import Role, User, UserRole
from app.rbac import Perm
from app.schemas import UserCreate, UserOut, UserUpdate
from app.security import hash_password

router = APIRouter(prefix="/users", tags=["users"])


def _out(u: User) -> UserOut:
    return UserOut(
        id=u.id,
        email=u.email,
        display_name=u.display_name,
        roles=sorted(u.roles),
        is_active=u.is_active,
        created_at=u.created_at,
    )


@router.get("/roles")
def list_roles(db: DB, p: CurrentUser) -> list[dict]:
    p.require(Perm.USERS_MANAGE)
    return [{"code": r.code, "title": r.title} for r in db.scalars(select(Role)).all()]


@router.get("", response_model=list[UserOut])
def list_users(db: DB, p: CurrentUser) -> list[UserOut]:
    p.require(Perm.USERS_MANAGE)
    return [_out(u) for u in db.scalars(select(User).order_by(User.created_at)).all()]


@router.post("", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, db: DB, p: CurrentUser, request: Request) -> UserOut:
    p.require(Perm.USERS_MANAGE)
    email = body.email.lower()
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise ApiError(409, "email_taken", "Пользователь с таким email уже есть")
    u = User(
        email=email, display_name=body.display_name, password_hash=hash_password(body.password)
    )
    u.role_links = [UserRole(role_code=r) for r in body.roles]
    db.add(u)
    db.flush()
    audit.record(
        db,
        actor_id=p.user.id,
        action="user.create",
        entity_type="user",
        entity_id=u.id,
        details={"roles": body.roles},
        request=request,
    )
    db.commit()
    return _out(u)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: UUID, body: UserUpdate, db: DB, p: CurrentUser, request: Request
) -> UserOut:
    p.require(Perm.USERS_MANAGE)
    u = db.get(User, user_id)
    if u is None:
        raise not_found("Пользователь")
    changes: dict = {}
    if u.id == p.user.id:
        if body.is_active is False:
            raise ApiError(409, "self_disable", "Нельзя отключить собственную учётную запись")
        if body.roles is not None and "admin" not in body.roles:
            raise ApiError(409, "self_demote", "Нельзя снять с себя роль администратора")
    if body.display_name is not None:
        u.display_name = body.display_name
        changes["display_name"] = True
    if body.roles is not None:
        changes["roles"] = {"from": sorted(u.roles), "to": body.roles}
        u.role_links = [UserRole(role_code=r) for r in body.roles]
    if body.is_active is not None:
        u.is_active = body.is_active
        changes["is_active"] = body.is_active
    if body.password is not None:
        u.password_hash = hash_password(body.password)
        changes["password_reset"] = True
    audit.record(
        db,
        actor_id=p.user.id,
        action="user.update",
        entity_type="user",
        entity_id=u.id,
        details=changes,
        request=request,
    )
    db.commit()
    db.refresh(u)
    return _out(u)
