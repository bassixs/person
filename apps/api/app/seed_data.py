"""Исходная семёрка (PROJECT_CONTEXT §4): только краткие легенды → черновики.

Правила:
- всё, что есть в легенде, помечено source_kind=original_legend, editor_approved=False;
- приблизительные сведения из легенды хранятся как есть («около 52 лет»), без уточнения;
- всё, чего нет в легенде, остаётся «неизвестно» и перечислено в limits.known_unknowns;
- общественно-политические предпочтения из первоначального описания НЕ переносятся
  в структурированные поля (их содержание не передано и не должно использоваться для
  оптимизации политических сообщений).
"""

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.passport import Passport

L = "original_legend"


def _f(value: Any) -> dict[str, Any]:
    return {"value": value, "source_kind": L, "certainty": "defined", "editor_approved": False}


SEED_PERSONAS: list[dict[str, Any]] = [
    {
        "name": "Артем Вишнев",
        "short_context": "Гараж, рыбалка, футбол, автомобили; практический взгляд на быт.",
        "legend": (
            "Мужчина, гражданский брак. Гараж, рыбалка, футбол, автомобили; практический "
            "взгляд на бытовые вопросы. В первоначальном описании также имелись "
            "общественно-политические предпочтения (содержание в проект не переносится)."
        ),
        "fields": {
            "family": {"family_status": _f("Гражданский брак")},
            "experience": {"hobbies": _f(["гараж", "рыбалка", "футбол", "автомобили"])},
            "worldview": {"reasoning_style": _f("Практический взгляд на бытовые вопросы")},
        },
        "unknowns": [
            "точный возраст",
            "профессия",
            "место работы",
            "уровень технических знаний",
            "семейная история",
            "точные формулировки взглядов",
        ],
    },
    {
        "name": "Любовь Богданова",
        "short_context": "Около 60–65 лет, пенсия, дача и теплица, телесериалы.",
        "legend": (
            "Женщина приблизительно 60–65 лет; супруг Коля, около 40 лет в браке; пенсия, "
            "дача, теплица, телесериалы, телевидение, Надежда Кадышева."
        ),
        "fields": {
            "legend": {
                "age_range": _f("около 60–65 лет"),
                "occupation": _f("На пенсии"),
            },
            "family": {
                "family_status": _f("Замужем, около 40 лет в браке"),
                "close_people": _f(["супруг Коля"]),
            },
            "experience": {
                "hobbies": _f(
                    ["дача", "теплица", "телесериалы", "телевидение", "песни Надежды Кадышевой"]
                ),
            },
        },
        "unknowns": [
            "конкретный возраст",
            "адрес",
            "профессия до пенсии",
            "дети и внуки",
            "образование",
        ],
    },
    {
        "name": "Галина Воронова",
        "short_context": "Около 52 лет; кошки, цветы, рецепты.",
        "legend": "Около 52 лет; любит кошек, цветы и рецепты.",
        "fields": {
            "legend": {"age_range": _f("около 52 лет")},
            "experience": {"hobbies": _f(["кошки", "цветы", "рецепты"])},
        },
        "unknowns": ["профессия", "семья", "регион проживания", "жизненные обстоятельства"],
    },
    {
        "name": "Андрей Бочаров",
        "short_context": "Около 46 лет, фермер, спокойный «обычный» человек.",
        "legend": "Около 46 лет; фермер, спокойный «обычный» человек.",
        "fields": {
            "legend": {"age_range": _f("около 46 лет"), "occupation": _f("Фермер")},
            "character": {"traits": _f(["спокойный"])},
        },
        "unknowns": [
            "размер хозяйства",
            "конкретная специализация",
            "семейное положение",
            "убеждения",
        ],
    },
    {
        "name": "Валентина Абрамова",
        "short_context": "Удалённая работа, горы и походы; между городом и деревней.",
        "legend": (
            "Независимая женщина, удалённо работает с ноутбуком, любит горы, походы и поездки; "
            "жизнь между городом и деревней, ценит свободу."
        ),
        "fields": {
            "legend": {
                "occupation": _f("Удалённая работа с ноутбуком (род занятий не уточнён)"),
                "geography": _f("Живёт между городом и деревней"),
            },
            "experience": {"hobbies": _f(["горы", "походы", "поездки"])},
            "character": {"traits": _f(["независимая"])},
            "worldview": {"values": _f(["свобода"])},
        },
        "unknowns": ["точная профессия", "возраст", "конкретные города", "происхождение дохода"],
    },
    {
        "name": "Игорь Давыдов",
        "short_context": "Около 37 лет, автосервис, интерес к истории Второй мировой войны.",
        "legend": (
            "Около 37 лет, автосервис, разведён, интересуется историей и темой Второй мировой "
            "войны, слушает Михаила Круга; в исходной легенде упоминалось употребление алкоголя."
        ),
        "fields": {
            "legend": {
                "age_range": _f("около 37 лет"),
                "occupation": _f("Связан с автосервисом (должность не уточнена)"),
            },
            "family": {"family_status": _f("Разведён")},
            "experience": {
                "hobbies": _f(["история", "тема Второй мировой войны", "песни Михаила Круга"]),
            },
        },
        "restrictions": (
            "Медицинские и личные сведения (в т.ч. упоминание алкоголя в исходной легенде) "
            "не детализировать и не использовать как характеристику без решения редактора."
        ),
        "unknowns": [
            "конкретная должность",
            "места работы",
            "медицинские и личные сведения",
            "точная биография",
        ],
    },
    {
        "name": "Вадим Мельников",
        "short_context": "Около 40 лет; история, книги, самиздат, World of Tanks.",
        "legend": (
            "Около 40 лет; история, книги, самиздат, игра World of Tanks; в исходной легенде "
            "присутствовали разговорные самоописания."
        ),
        "fields": {
            "legend": {"age_range": _f("около 40 лет")},
            "experience": {"hobbies": _f(["история", "книги", "самиздат", "World of Tanks"])},
        },
        "unknowns": [
            "род занятий",
            "глубина исторических знаний",
            "семья",
            "социальный круг",
            "убеждения",
        ],
    },
]


def seed_passport(item: dict[str, Any]) -> "Passport":
    """Черновой паспорт из легенды: только сведения легенды, остальное — «неизвестно»."""
    from app.passport import Passport, PassportField, empty_passport

    passport = empty_passport()
    passport.sections["legend"].fields["full_name"] = PassportField(
        value=item["name"], source_kind=L, certainty="defined"
    )
    for skey, fields in item["fields"].items():
        for fkey, data in fields.items():
            passport.sections[skey].fields[fkey] = PassportField(**data)
    passport.sections["limits"].fields["known_unknowns"] = PassportField(
        value=item["unknowns"], source_kind=L, certainty="defined"
    )
    if item.get("restrictions"):
        passport.sections["limits"].fields["editor_restrictions"] = PassportField(
            value=item["restrictions"], source_kind=L, certainty="defined"
        )
    passport.sections["limits"].narrative = (
        "Черновик создан из краткой исходной легенды. Всё, чего нет в легенде, "
        "остаётся неизвестным до интервью и решения редактора."
    )
    return Passport.model_validate(passport.model_dump())


def demo_fixtures() -> dict[str, Any]:
    """Данные для демо-сборки: та же схема и те же черновики, что у настоящего backend."""
    from app.passport import schema_document

    return {
        "schema": schema_document(),
        "seed": [
            {
                "name": item["name"],
                "short_context": item["short_context"],
                "legend": item["legend"],
                "passport": seed_passport(item).model_dump(mode="json"),
            }
            for item in SEED_PERSONAS
        ],
    }
