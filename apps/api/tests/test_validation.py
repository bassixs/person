"""Итерация 2: проверка целостности паспорта, «светофор», барьер активации по content_hash.

Модель и Decisions подменяются сценарными ответами; API, БД, триггеры и фоновые задачи — настоящие
(в тестах фоновые задачи выполняются сразу).
"""

import json

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.ai.client import Completion, set_provider_override
from app.ai.decisions import set_decisions_override
from app.db import get_engine

CRITICAL = {
    "summary": "Есть взаимоисключающие сведения о профессии.",
    "issues": [
        {
            "severity": "critical",
            "kind": "contradiction",
            "title": "Профессия противоречит компетенциям",
            "explanation": "В легенде профессия неизвестна, а в компетенциях — профессиональный автомеханик.",
            "field_paths": ["legend.occupation", "competence.knowledge_areas"],
            "suggestion": "Уберите профессиональную формулировку из компетенций.",
            "fix": {
                "field_path": "competence.knowledge_areas",
                "value": ["ремонт своей машины как хобби"],
            },
        },
        {
            "severity": "critical",
            "kind": "unusual_compatible",
            "title": "Вспыльчив дома, сдержан на работе",
            "explanation": "Совместимые черты.",
            "field_paths": ["character.traits"],
        },
        {
            "severity": "warning",
            "kind": "unspecified",
            "title": "Неясно, где живёт",
            "explanation": "География не указана, а в быту упоминается дача.",
            "field_paths": ["legend.geography"],
            "fix": {"field_path": "legend.full_name", "value": "взлом имени"},
        },
    ],
}
CLEAN = {"summary": "Противоречий нет.", "issues": []}


class ScriptedLLM:
    model = "scripted-check-model"

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []

    def complete(self, messages):
        self.calls.append(messages)
        r = self.replies.pop(0)
        return Completion(
            text=r if isinstance(r, str) else json.dumps(r, ensure_ascii=False),
            model=self.model,
            cost_rub=1.5,
        )


class ScriptedDecisions:
    model = "scripted-decider"

    def __init__(self, severity="none", p=0.05):
        self.severity, self.p, self.calls = severity, p, []

    def decide(self, state, questions):
        self.calls.append(state)
        return {
            "conflict": {"type": "noul", "noul": self.p},
            "severity": {"type": "choice", "choice": self.severity},
        }, {"cost_rub": 0.001}


@pytest.fixture
def ai():
    holder = {}

    def _set(*replies, decisions=None):
        holder["llm"] = ScriptedLLM(*replies)
        set_provider_override(holder["llm"])
        set_decisions_override(decisions)
        return holder["llm"]

    yield _set
    set_provider_override(None)
    set_decisions_override(None)


def _persona(api):
    r = api.post(
        "/api/v1/personas",
        json={"display_name": "Пётр Проверкин", "short_context": "", "mode": "manual"},
    )
    assert r.status_code == 201, r.text
    return r.json()


def _draft(api, pid):
    d = api.get(f"/api/v1/personas/{pid}").json()
    return api.get(f"/api/v1/personas/{pid}/versions/{d['draft_version']['id']}").json()


def _blockers(api, pid):
    v = _draft(api, pid)
    return {
        b["code"]
        for b in api.get(
            f"/api/v1/personas/{pid}/activation-check", params={"version_id": v["id"]}
        ).json()["blockers"]
    }


def _run(api, pid, kind):
    r = api.post(f"/api/v1/personas/{pid}/validations", json={"kind": kind})
    assert r.status_code == 202, r.text
    return api.get(f"/api/v1/personas/{pid}/validations/{r.json()['id']}").json()


def test_without_llm_check_is_unavailable(client_for):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    r = api.post(f"/api/v1/personas/{p['id']}/validations", json={"kind": "check"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "llm_not_configured"
    assert api.get(f"/api/v1/personas/{p['id']}/consistency").json()["status"] == "unavailable"


def test_check_report_is_stored_and_classified(client_for, ai):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    llm = ai(CRITICAL)
    run = _run(api, p["id"], "check")
    assert run["status"] == "done" and run["is_current"] is True
    assert run["model"] == "scripted-check-model"
    # «Необычное, но совместимое» не бывает проблемой — сервер приводит его к info.
    kinds = {(i["kind"], i["severity"]) for i in run["issues"]}
    assert ("unusual_compatible", "info") in kinds and ("contradiction", "critical") in kinds
    assert (run["critical_count"], run["warning_count"], run["info_count"]) == (1, 1, 1)
    # Исправление имени отброшено, сама находка сохранена.
    geo = next(i for i in run["issues"] if i["kind"] == "unspecified")
    assert geo["fix_field_path"] is None
    # В модель ушёл паспорт как данные.
    assert "<passport>" in llm.calls[0][1]["content"]
    # Обычная проверка не открывает активацию — нужна финальная.
    assert "validation_missing" in _blockers(api, p["id"])


def test_activation_barrier_follows_final_run_and_content_hash(client_for, ai):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    ai(CRITICAL, CLEAN)
    final = _run(api, p["id"], "final")
    assert _blockers(api, p["id"]) >= {"validation_critical", "lab_missing"}
    assert "validation_missing" not in _blockers(api, p["id"])

    # Исправление из отчёта становится обычным предложением; принимает редактор.
    issue = next(i for i in final["issues"] if i["severity"] == "critical")
    r = api.post(
        f"/api/v1/personas/{p['id']}/validations/{final['id']}/issues/{issue['id']}/propose"
    )
    assert r.status_code == 201, r.text
    pr = r.json()
    assert pr["origin"] == "validation" and pr["field_path"] == "competence.knowledge_areas"
    again = api.post(
        f"/api/v1/personas/{p['id']}/validations/{final['id']}/issues/{issue['id']}/propose"
    ).json()
    assert again["id"] == pr["id"]  # повторное нажатие не плодит дубли
    v = _draft(api, p["id"])
    assert (
        api.post(
            f"/api/v1/personas/{p['id']}/proposals/{pr['id']}/accept",
            json={"expected_revision": v["revision"]},
        ).status_code
        == 200
    )

    # Паспорт изменился → старая финальная проверка не действует.
    runs = api.get(f"/api/v1/personas/{p['id']}/validations").json()
    assert runs[0]["is_current"] is False
    assert "validation_missing" in _blockers(api, p["id"])

    _run(api, p["id"], "final")  # CLEAN
    assert _blockers(api, p["id"]) == {"lab_missing"}  # остаётся только лаборатория
    r = api.post(
        f"/api/v1/personas/{p['id']}/activate", json={"version_id": _draft(api, p["id"])["id"]}
    )
    assert r.status_code == 409 and {b["code"] for b in r.json()["error"]["details"]} == {
        "lab_missing"
    }


def test_failed_model_marks_run_failed(client_for, ai):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    ai("не json", "опять не json")
    run = _run(api, p["id"], "check")
    assert run["status"] == "failed" and run["error"]
    assert run["issues"] == []


def test_traffic_light_per_content_hash(client_for, ai):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    dec = ScriptedDecisions(severity="critical", p=0.95)
    ai(decisions=dec)
    s = api.get(f"/api/v1/personas/{p['id']}/consistency").json()
    assert s["status"] == "ready" and s["level"] == "red" and s["model"] == "scripted-decider"
    assert s["content_hash"] == _draft(api, p["id"])["content_hash"]
    # Светофор не блокирует и не открывает активацию.
    assert "validation_missing" in _blockers(api, p["id"])

    dec.severity, dec.p = "none", 0.02
    v = _draft(api, p["id"])
    passport = v["passport"]
    passport["sections"]["legend"]["fields"]["age_range"] = {
        "value": "около 40 лет",
        "certainty": "hypothesis",
        "source_kind": "editor",
        "editor_approved": True,
        "dependencies": [],
    }
    assert (
        api.put(
            f"/api/v1/personas/{p['id']}/versions/{v['id']}",
            json={"passport": passport, "expected_revision": v["revision"]},
        ).status_code
        == 200
    )
    s2 = api.get(f"/api/v1/personas/{p['id']}/consistency").json()
    assert s2["level"] == "green" and s2["content_hash"] != s["content_hash"]
    assert "legend.age_range" in dec.calls[-1]["persona_passport"]


def test_rights_and_db_guard(client_for, ai):
    editor = client_for("ed@example.org", ["editor"])
    p = _persona(editor)
    ai(CRITICAL)
    run = _run(editor, p["id"], "check")

    admin = client_for("adm@example.org", ["admin"])
    assert admin.get(f"/api/v1/personas/{p['id']}/validations").status_code == 200
    assert (
        admin.post(f"/api/v1/personas/{p['id']}/validations", json={"kind": "final"}).status_code
        == 403
    )
    operator = client_for("op@example.org", ["operator"])
    assert operator.get(f"/api/v1/personas/{p['id']}/validations").status_code == 403

    with pytest.raises(DBAPIError):
        with get_engine().begin() as c:
            c.execute(
                text("UPDATE persona_validation_runs SET critical_count = 0 WHERE id = :i"),
                {"i": run["id"]},
            )
    with pytest.raises(DBAPIError):
        with get_engine().begin() as c:
            c.execute(
                text("UPDATE persona_validation_issues SET severity = 'info' WHERE run_id = :i"),
                {"i": run["id"]},
            )
