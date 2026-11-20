"""Матрица прав (PROJECT_CONTEXT §13.1, ТЗ §4). Проверяется на backend для каждого запроса.

Ключевые инварианты:
- admin сам по себе НЕ может создавать/править/активировать контент — только при роли editor/author;
- активировать может только editor (в т.ч. собственную работу);
- operator работает только с утверждёнными сущностями и ничего не утверждает.
"""

from enum import StrEnum


class Perm(StrEnum):
    PERSONA_READ_ALL = "persona.read_all"  # видеть черновики и все версии
    PERSONA_READ_ACTIVE = "persona.read_active"  # только активные версии
    PERSONA_CREATE = "persona.create"
    PERSONA_EDIT = "persona.edit"
    PERSONA_ARCHIVE = "persona.archive"
    PERSONA_ACTIVATE = "persona.activate"
    TOPIC_READ_ALL = "topic.read_all"  # черновики тем и все версии
    TOPIC_READ_ACTIVE = "topic.read_active"
    TOPIC_CREATE = "topic.create"
    TOPIC_EDIT = "topic.edit"
    TOPIC_ARCHIVE = "topic.archive"
    TOPIC_APPROVE = "topic.approve"  # утвердить тему, подтвердить/опровергнуть факт, пометки
    USERS_MANAGE = "users.manage"
    AUDIT_READ = "audit.read"
    INTEGRATIONS_DIAGNOSE = "integrations.diagnose"


ROLE_PERMS: dict[str, set[Perm]] = {
    "admin": {
        Perm.PERSONA_READ_ALL,
        Perm.TOPIC_READ_ALL,
        Perm.USERS_MANAGE,
        Perm.AUDIT_READ,
        Perm.INTEGRATIONS_DIAGNOSE,
    },
    "editor": {
        Perm.PERSONA_READ_ALL,
        Perm.PERSONA_READ_ACTIVE,
        Perm.PERSONA_CREATE,
        Perm.PERSONA_EDIT,
        Perm.PERSONA_ARCHIVE,
        Perm.PERSONA_ACTIVATE,
        Perm.TOPIC_READ_ALL,
        Perm.TOPIC_READ_ACTIVE,
        Perm.TOPIC_CREATE,
        Perm.TOPIC_EDIT,
        Perm.TOPIC_ARCHIVE,
        Perm.TOPIC_APPROVE,
        Perm.AUDIT_READ,
    },
    "author": {
        Perm.PERSONA_READ_ALL,
        Perm.PERSONA_READ_ACTIVE,
        Perm.PERSONA_CREATE,
        Perm.PERSONA_EDIT,
        Perm.TOPIC_READ_ALL,
        Perm.TOPIC_READ_ACTIVE,
        Perm.TOPIC_CREATE,
        Perm.TOPIC_EDIT,
    },
    "operator": {Perm.PERSONA_READ_ACTIVE, Perm.TOPIC_READ_ACTIVE},
}


def permissions_for(roles: set[str]) -> set[Perm]:
    perms: set[Perm] = set()
    for r in roles:
        perms |= ROLE_PERMS.get(r, set())
    return perms
