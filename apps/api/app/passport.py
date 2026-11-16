"""Гибридная схема паспорта личности (версия 1).

Паспорт = 9 разделов; в каждом — структурированные поля с происхождением/определённостью
и развёрнутый нарратив. Схема версионируется (SCHEMA_VERSION), frontend получает её через
GET /api/v1/personas/schema и рендерит формы из неё — единый источник истины.

Правила (PROJECT_CONTEXT §6.5, ТЗ §3):
- value + source_kind + certainty + editor_approved + dependencies;
- «unknown» — полноценное состояние, а не ошибка;
- гипотеза (ai_suggestion / hypothesis) не становится установленным фактом сама по себе.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

SCHEMA_VERSION: Literal[1] = 1

SourceKind = Literal["original_legend", "editor", "ai_suggestion"]
Certainty = Literal["defined", "hypothesis", "unknown"]
FieldType = Literal["text", "longtext", "tags"]

# (ключ раздела, заголовок, описание, [(ключ поля, подпись, тип, подсказка)])
_SECTIONS: list[tuple[str, str, str, list[tuple[str, str, FieldType, str]]]] = [
    (
        "legend",
        "Легенда и биография",
        "Общее описание жизненной ситуации вымышленной аналитической персоны.",
        [
            ("full_name", "Имя", "text", "Вымышленное имя персоны"),
            ("age_range", "Возрастной диапазон", "text", "Например: 45–50 лет"),
            ("occupation", "Род занятий", "text", "Если неизвестно — оставьте «неизвестно»"),
            ("geography", "География", "text", "Тип населённого пункта / регион"),
            ("life_situation", "Жизненная ситуация", "longtext", "Коротко о текущем положении"),
        ],
    ),
    (
        "family",
        "Семья и окружение",
        "Как устроена ежедневная жизнь и ближний круг.",
        [
            ("family_status", "Семейное положение", "text", ""),
            ("close_people", "Близкие люди", "tags", "Роли, без реальных персональных данных"),
            ("household", "Бытовой контекст", "longtext", "Жильё, быт, распорядок"),
        ],
    ),
    (
        "experience",
        "Жизненный опыт",
        "Предыдущий опыт и его влияние на взгляд на события.",
        [
            ("life_stages", "Этапы жизни", "longtext", ""),
            ("work_history", "Трудовой опыт", "longtext", ""),
            ("hobbies", "Увлечения", "tags", ""),
        ],
    ),
    (
        "character",
        "Характер",
        "Проявление устойчивых особенностей в разных ситуациях.",
        [
            ("traits", "Черты", "tags", ""),
            ("emotionality", "Эмоциональность", "text", ""),
            ("habits", "Привычки", "tags", ""),
        ],
    ),
    (
        "worldview",
        "Мировосприятие",
        "Как персона интерпретирует события. Не политическая инструкция.",
        [
            ("values", "Ценности", "tags", ""),
            ("priorities", "Приоритеты", "tags", ""),
            ("reasoning_style", "Способ рассуждения", "longtext", ""),
        ],
    ),
    (
        "competence",
        "Компетенции и границы знаний",
        "Что знает, чего не знает и где склонна ошибаться.",
        [
            ("knowledge_areas", "Области знаний", "tags", ""),
            ("confidence", "Степень уверенности", "text", ""),
            ("knowledge_limits", "Границы знаний", "longtext", "Чего персона не знает"),
            ("typical_mistakes", "Типичные ошибки", "longtext", ""),
        ],
    ),
    (
        "speech",
        "Речевой почерк",
        "Языковые особенности для внутреннего анализа, не для имитации реального свидетеля.",
        [
            ("phrase_length", "Длина фраз", "text", ""),
            ("vocabulary", "Лексика", "longtext", ""),
            ("formality", "Формальность", "text", ""),
            ("humor", "Юмор", "text", ""),
        ],
    ),
    (
        "behavior",
        "Поведенческие реакции",
        "Реакции на неполноту сведений, конфликт и новые факты.",
        [
            ("on_incomplete_info", "При неполных сведениях", "longtext", ""),
            ("on_conflict", "В конфликте", "longtext", ""),
            ("on_new_facts", "На новые факты", "longtext", ""),
        ],
    ),
    (
        "limits",
        "Ограничения и происхождение",
        "Где ИИ обязан обозначить пробел, а не додумать факт.",
        [
            ("known_unknowns", "Известные неизвестные", "tags", ""),
            ("editor_restrictions", "Редакторские ограничения", "longtext", ""),
            ("provenance_notes", "Заметки о происхождении", "longtext", ""),
        ],
    ),
]


def schema_document() -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "source_kinds": {
            "original_legend": "Исходная легенда",
            "editor": "Редактор",
            "ai_suggestion": "Предложение ИИ",
        },
        "certainties": {
            "defined": "Определено",
            "hypothesis": "Гипотеза",
            "unknown": "Неизвестно",
        },
        "sections": [
            {
                "key": key,
                "title": title,
                "description": description,
                "fields": [
                    {"key": fk, "label": label, "type": ftype, "hint": hint}
                    for fk, label, ftype, hint in fields
                ],
            }
            for key, title, description, fields in _SECTIONS
        ],
    }


FIELD_TYPES: dict[str, dict[str, FieldType]] = {
    key: {fk: ftype for fk, _, ftype, _ in fields} for key, _, _, fields in _SECTIONS
}
ALL_FIELD_PATHS = {f"{s}.{f}" for s, fields in FIELD_TYPES.items() for f in fields}


class PassportField(BaseModel):
    value: str | list[str] | None = None
    source_kind: SourceKind = "editor"
    certainty: Certainty = "unknown"
    editor_approved: bool = False
    dependencies: list[str] = Field(default_factory=list)

    @field_validator("dependencies")
    @classmethod
    def _deps_known(cls, v: list[str]) -> list[str]:
        unknown = [d for d in v if d not in ALL_FIELD_PATHS]
        if unknown:
            raise ValueError(f"Неизвестные зависимые поля: {', '.join(unknown)}")
        return sorted(set(v))

    @model_validator(mode="after")
    def _normalize(self) -> PassportField:
        if isinstance(self.value, str):
            self.value = self.value.strip() or None
        elif isinstance(self.value, list):
            cleaned = [x.strip() for x in self.value if x and x.strip()]
            self.value = cleaned or None
        if self.value is None:
            # Пустое значение = «неизвестно». Определённость без значения невозможна,
            # подтверждать редактором нечего.
            self.certainty = "unknown"
            self.editor_approved = False
        elif self.certainty == "unknown":
            raise ValueError("Поле со значением не может иметь определённость «неизвестно»")
        return self


class PassportSection(BaseModel):
    fields: dict[str, PassportField]
    narrative: str = ""

    @field_validator("narrative")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class Passport(BaseModel):
    schema_version: Literal[1] = SCHEMA_VERSION
    sections: dict[str, PassportSection]

    @model_validator(mode="after")
    def _shape(self) -> Passport:
        if set(self.sections) != set(FIELD_TYPES):
            raise ValueError("Паспорт должен содержать ровно 9 разделов схемы")
        for skey, section in self.sections.items():
            expected = FIELD_TYPES[skey]
            extra = set(section.fields) - set(expected)
            if extra:
                raise ValueError(f"Раздел {skey}: неизвестные поля {', '.join(sorted(extra))}")
            for fkey, ftype in expected.items():
                fld = section.fields.setdefault(fkey, PassportField())
                if fld.value is not None:
                    if ftype == "tags" and not isinstance(fld.value, list):
                        raise ValueError(f"{skey}.{fkey}: ожидается список")
                    if ftype != "tags" and not isinstance(fld.value, str):
                        raise ValueError(f"{skey}.{fkey}: ожидается текст")
        return self


def empty_passport() -> Passport:
    return Passport(
        sections={
            skey: PassportSection(fields={fk: PassportField() for fk in fields})
            for skey, fields in FIELD_TYPES.items()
        }
    )


def canonical_json(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def content_hash(passport: Passport) -> str:
    return hashlib.sha256(canonical_json(passport.model_dump(mode="json")).encode()).hexdigest()


def merge_editor_update(previous: Passport, incoming: Passport) -> tuple[Passport, list[str]]:
    """Применяет ручную правку редактора с серверным контролем происхождения.

    - Если значение поля изменилось — source_kind принудительно «editor»
      (ручная правка не может выдать себя за легенду или ИИ).
    - Если значение не менялось — происхождение сохраняется прежним,
      клиент не может переписать provenance.
    - Ручная правка не может присвоить полю «ai_suggestion»: предложения ИИ
      попадают в паспорт только через очередь предложений (итерация 2).
    Возвращает новый паспорт и список изменённых путей.
    """
    changed: list[str] = []
    result = incoming.model_copy(deep=True)
    for skey, section in result.sections.items():
        prev_section = previous.sections[skey]
        if section.narrative != prev_section.narrative:
            changed.append(f"{skey}.narrative")
        for fkey, fld in section.fields.items():
            prev = prev_section.fields[fkey]
            if fld.value != prev.value:
                fld.source_kind = "editor"
                changed.append(f"{skey}.{fkey}")
            else:
                fld.source_kind = prev.source_kind
                if fld.certainty != prev.certainty or fld.dependencies != prev.dependencies:
                    changed.append(f"{skey}.{fkey}")
            if fld.editor_approved != prev.editor_approved:
                changed.append(f"{skey}.{fkey}")
    return result, sorted(set(changed))


def completeness(passport: Passport) -> dict[str, Any]:
    per_section = {}
    total = filled = 0
    for skey, section in passport.sections.items():
        n = len(section.fields)
        f = sum(1 for x in section.fields.values() if x.certainty != "unknown")
        per_section[skey] = {
            "fields_total": n,
            "fields_filled": f,
            "has_narrative": bool(section.narrative),
            "hypotheses": sum(1 for x in section.fields.values() if x.certainty == "hypothesis"),
        }
        total += n
        filled += f
    return {"fields_total": total, "fields_filled": filled, "sections": per_section}
