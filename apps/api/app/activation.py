"""Барьер активации версии паспорта (D-13, D-14, PROJECT_CONTEXT §7.4).

Активация разрешена только если:
1. версия в состоянии draft и это актуальный черновик персоны;
2. заполнены обязательные данные (имя);
3. существует актуальный прогон ПОЛНОЙ проверки согласованности для текущего content_hash
   без critical-находок;
4. существует актуальный прогон лаборатории (6 групп) для текущего content_hash без critical.

Пункт 3 — финальная проверка (ValidationRun kind=final, модель LLM_MODEL_FINAL, E-028) именно для
текущего content_hash: любая правка после неё делает её неактуальной. «Светофор» Decisions на барьер
не влияет — это только подсказка. Пункт 4 (лаборатория) — следующий шаг итерации 2.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PersonaVersion, ValidationRun
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
    final = db.scalar(
        select(ValidationRun)
        .where(
            ValidationRun.version_id == version.id,
            ValidationRun.content_hash == version.content_hash,
            ValidationRun.kind == "final",
            ValidationRun.status == "done",
        )
        .order_by(ValidationRun.finished_at.desc())
    )
    if final is None:
        blockers.append(
            Blocker(
                "validation_missing",
                "Нет финальной проверки целостности для текущего содержимого "
                f"{version.content_hash[:12]} (после правок её нужно запустить заново)",
            )
        )
    elif final.critical_count:
        blockers.append(
            Blocker(
                "validation_critical",
                f"Финальная проверка нашла критические противоречия: {final.critical_count}. "
                "Исправьте их и запустите проверку снова",
            )
        )
    blockers.append(
        Blocker(
            "lab_missing",
            "Лаборатория (6 групп испытаний) не прогонялась для текущего содержимого",
        )
    )
    return blockers
