"""Барьер активации версии паспорта (D-13, D-14, PROJECT_CONTEXT §7.4).

Активация разрешена только если:
1. версия в состоянии draft и это актуальный черновик персоны;
2. заполнены обязательные данные (имя);
3. существует актуальный прогон ПОЛНОЙ проверки согласованности для текущего content_hash
   без critical-находок;
4. существует актуальный прогон лаборатории (6 групп) для текущего content_hash без critical.

Пункты 3–4 реализуются в итерации 2 (таблицы persona_validation_runs / persona_test_runs).
До этого функция честно сообщает, что проверок нет — и активация блокируется на backend.
"""

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models import PersonaVersion
from app.passport import Passport


@dataclass
class Blocker:
    code: str
    message: str


def activation_blockers(db: Session, version: PersonaVersion) -> list[Blocker]:
    blockers: list[Blocker] = []
    if version.state != "draft":
        blockers.append(Blocker("not_draft", "Активировать можно только черновик"))
    passport = Passport.model_validate(version.passport)
    name = passport.sections["legend"].fields["full_name"]
    if name.certainty == "unknown":
        blockers.append(Blocker("missing_required", "Не заполнено обязательное поле «Имя»"))
    # Итерация 2: искать validation/test runs по version.content_hash.
    blockers.append(
        Blocker(
            "validation_missing",
            f"Нет актуальной полной проверки согласованности для содержимого "
            f"{version.content_hash[:12]}",
        )
    )
    blockers.append(
        Blocker(
            "lab_missing",
            "Лаборатория (6 групп испытаний) не прогонялась для текущего содержимого",
        )
    )
    return blockers
