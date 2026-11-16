"""Служебные команды.

  python -m app.cli create-user --email E --name N --roles editor,author [--password P]
  python -m app.cli seed-personas --as editor@example.org --confirm

Пароль, если не передан, запрашивается интерактивно (не попадает в историю shell).
"""

import argparse
import getpass
import sys

from sqlalchemy import func, select

from app.db import session_factory
from app.deps import Principal
from app.models import Persona, User, UserRole
from app.passport import Passport, PassportField, empty_passport
from app.rbac import Perm, permissions_for
from app.security import hash_password
from app.seed_data import SEED_PERSONAS
from app.services.personas import create_persona


def cmd_create_user(a: argparse.Namespace) -> int:
    password = a.password or getpass.getpass("Пароль (мин. 10 символов): ")
    if len(password) < 10:
        print("Пароль слишком короткий", file=sys.stderr)
        return 2
    roles = [r for r in a.roles.split(",") if r]
    with session_factory()() as db:
        if db.scalar(select(User).where(func.lower(User.email) == a.email.lower())):
            print("Пользователь уже существует", file=sys.stderr)
            return 1
        u = User(email=a.email.lower(), display_name=a.name, password_hash=hash_password(password))
        u.role_links = [UserRole(role_code=r) for r in roles]
        db.add(u)
        db.commit()
        print(f"Создан пользователь {u.email} с ролями {roles}")
    return 0


def cmd_seed(a: argparse.Namespace) -> int:
    if not a.confirm:
        print("Добавьте --confirm: будут созданы 7 ЧЕРНОВИКОВ (без активации).", file=sys.stderr)
        return 2
    with session_factory()() as db:
        actor = db.scalar(select(User).where(func.lower(User.email) == a.actor.lower()))
        if actor is None:
            print("Пользователь --as не найден", file=sys.stderr)
            return 1
        perms = permissions_for(actor.roles)
        if Perm.PERSONA_CREATE not in perms:
            print("У пользователя нет права создавать личности (editor/author)", file=sys.stderr)
            return 1
        p = Principal(user=actor, session=None, roles=actor.roles, perms=perms)  # type: ignore[arg-type]
        created = 0
        for item in SEED_PERSONAS:
            exists = db.scalar(
                select(Persona).where(Persona.display_name == item["name"], Persona.is_seed)
            )
            if exists:
                print(f"  пропуск (уже есть): {item['name']}")
                continue
            passport = empty_passport()
            passport.sections["legend"].fields["full_name"] = PassportField(
                value=item["name"], source_kind="original_legend", certainty="defined"
            )
            for skey, fields in item["fields"].items():
                for fkey, data in fields.items():
                    passport.sections[skey].fields[fkey] = PassportField(**data)
            passport.sections["limits"].fields["known_unknowns"] = PassportField(
                value=item["unknowns"], source_kind="original_legend", certainty="defined"
            )
            if item.get("restrictions"):
                passport.sections["limits"].fields["editor_restrictions"] = PassportField(
                    value=item["restrictions"], source_kind="original_legend", certainty="defined"
                )
            passport.sections["limits"].narrative = (
                "Черновик создан из краткой исходной легенды. Всё, чего нет в легенде, "
                "остаётся неизвестным до интервью и решения редактора."
            )
            create_persona(
                db,
                p,
                display_name=item["name"],
                short_context=item["short_context"],
                mode="legend",
                legend_text=item["legend"],
                is_seed=True,
                initial_passport=Passport.model_validate(passport.model_dump()),
            )
            created += 1
            print(f"  создан черновик: {item['name']}")
        db.commit()
        print(f"Готово: создано {created} черновиков. Ни один не активирован.")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="app.cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    cu = sub.add_parser("create-user")
    cu.add_argument("--email", required=True)
    cu.add_argument("--name", required=True)
    cu.add_argument("--roles", default="")
    cu.add_argument("--password")
    sp = sub.add_parser("seed-personas")
    sp.add_argument("--as", dest="actor", required=True)
    sp.add_argument("--confirm", action="store_true")
    a = ap.parse_args(argv)
    return {"create-user": cmd_create_user, "seed-personas": cmd_seed}[a.cmd](a)


if __name__ == "__main__":
    raise SystemExit(main())
