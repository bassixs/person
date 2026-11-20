"""Итерация 2: лаборатория (6 групп), отправка на согласование, активация v1.0 → v1.1, приостановка.

Модель и Decisions подменяются сценарными ответами; API, БД, триггеры и фоновые задачи — настоящие.
"""

import json

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.ai.client import Completion, set_provider_override
from app.ai.decisions import set_decisions_override
from app.ai.lab import SUITE
from app.db import get_engine

SIM = {
    "answers": [
        {"case_key": c.key, "response": f"Ответ модели персоны на «{c.key}»."} for c in SUITE
    ]
}
CLEAN = {"summary": "Противоречий нет.", "issues": []}


def judge(verdicts: dict[str, str] | None = None) -> dict:
    """Ответ LLM-судьи: объяснения (и вердикты, если Decisions не подключён)."""
    verdicts = verdicts or {}
    return {
        "items": [
            {
                "case_key": c.key,
                "verdict": verdicts.get(c.key, "pass"),
                "explanation": f"Пояснение к {c.key}",
                "suggestion": "Уточнить паспорт",
            }
            for c in SUITE
        ]
    }


class ScriptedLLM:
    model = "scripted-model"

    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []

    def complete(self, messages):
        self.calls.append(messages)
        r = self.replies.pop(0)
        return Completion(
            text=r if isinstance(r, str) else json.dumps(r, ensure_ascii=False), model=self.model
        )


class ScriptedDecisions:
    """Вердикт по тест-кейсу: находит кейс по тексту вопроса в state."""

    model = "scripted-decider"

    def __init__(self, verdicts: dict[str, str]):
        self.verdicts, self.calls = verdicts, 0

    def decide(self, state, questions):
        self.calls += 1
        key = next(c.key for c in SUITE if c.prompt == state["test_case"])
        return {
            "verdict": {
                "type": "choice",
                "choice": self.verdicts.get(key, "pass"),
                "confidence": 0.9,
            }
        }, {}


@pytest.fixture
def ai():
    def _set(*replies, decisions=None):
        llm = ScriptedLLM(*replies)
        set_provider_override(llm)
        set_decisions_override(decisions)
        return llm

    yield _set
    set_provider_override(None)
    set_decisions_override(None)


def _persona(api):
    r = api.post(
        "/api/v1/personas",
        json={"display_name": "Лидия Лабораторная", "short_context": "", "mode": "manual"},
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


def _lab(api, pid):
    r = api.post(f"/api/v1/personas/{pid}/lab/runs")
    assert r.status_code == 202, r.text
    return api.get(f"/api/v1/personas/{pid}/lab/runs/{r.json()['id']}").json()


def _final(api, pid):
    r = api.post(f"/api/v1/personas/{pid}/validations", json={"kind": "final"})
    assert r.status_code == 202, r.text


def test_lab_without_llm_is_unavailable(client_for):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    r = api.post(f"/api/v1/personas/{p['id']}/lab/runs")
    assert r.status_code == 503 and r.json()["error"]["code"] == "llm_not_configured"
    ov = api.get(f"/api/v1/personas/{p['id']}/lab").json()
    assert ov["suite_version"] == "1.0" and len(ov["groups"]) == 6
    assert sum(len(g["cases"]) for g in ov["groups"]) == len(SUITE) == 12


def test_lab_run_with_decisions_and_explanations(client_for, ai):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    dec = ScriptedDecisions({"comp_outside": "critical", "lang_day": "warning"})
    llm = ai(SIM, judge(), decisions=dec)
    run = _lab(api, p["id"])
    assert run["status"] == "done" and run["is_current"] is True
    assert (run["pass_count"], run["warning_count"], run["critical_count"]) == (10, 1, 1)
    assert {r["lab_group"] for r in run["results"]} == {
        "biography",
        "character",
        "competence",
        "perception",
        "language",
        "uncertainty",
    }
    assert dec.calls == 12
    by = {r["case_key"]: r for r in run["results"]}
    # Объяснения — только для не-pass; судья видит только их.
    assert by["comp_outside"]["explanation"] and by["comp_outside"]["confidence"] == 0.9
    assert by["bio_intro"]["explanation"] is None
    judge_prompt = llm.calls[1][1]["content"]
    assert "comp_outside" in judge_prompt and "bio_intro" not in judge_prompt
    assert "lab_critical" in _blockers(api, p["id"])
    # Попытка активации с блокерами отклоняется сервером и попадает в журнал.
    v = _draft(api, p["id"])
    r = api.post(f"/api/v1/personas/{p['id']}/activate", json={"version_id": v["id"]})
    assert r.status_code == 409 and "lab_critical" in {
        b["code"] for b in r.json()["error"]["details"]
    }
    hist = api.get(f"/api/v1/personas/{p['id']}/history").json()
    assert any(
        e["action"] == "persona.activate_rejected" and "lab_critical" in e["details"]["blockers"]
        for e in hist
    )


def test_lab_fallback_llm_judge_without_decisions(client_for, ai):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    ai(SIM, judge({"unc_money": "critical"}))
    run = _lab(api, p["id"])
    assert run["critical_count"] == 1 and run["models"]["judge"] == run["models"]["explainer"]


def test_lab_incomplete_simulation_fails(client_for, ai):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    partial = {"answers": SIM["answers"][:5]}
    ai(partial, partial)
    run = _lab(api, p["id"])
    assert run["status"] == "failed" and run["results"] == []


def test_submit_requires_clean_current_validation(client_for, ai, make_user):
    author = client_for("au@example.org", ["author"])
    p = _persona(author)
    v = _draft(author, p["id"])
    r = author.post(f"/api/v1/personas/{p['id']}/submit", json={"version_id": v["id"]})
    assert r.status_code == 409 and r.json()["error"]["code"] == "validation_required"

    ai(CLEAN)
    assert (
        author.post(f"/api/v1/personas/{p['id']}/validations", json={"kind": "check"}).status_code
        == 202
    )
    r = author.post(f"/api/v1/personas/{p['id']}/submit", json={"version_id": v["id"]})
    assert r.status_code == 200 and r.json()["status"] == "pending_approval"

    # Правка после отправки возвращает черновик.
    passport = v["passport"]
    passport["sections"]["legend"]["fields"]["age_range"] = {
        "value": "около 30",
        "certainty": "hypothesis",
        "source_kind": "editor",
        "editor_approved": True,
        "dependencies": [],
    }
    assert (
        author.put(
            f"/api/v1/personas/{p['id']}/versions/{v['id']}",
            json={"passport": passport, "expected_revision": v["revision"]},
        ).status_code
        == 200
    )
    assert author.get(f"/api/v1/personas/{p['id']}").json()["status"] == "draft"


def test_full_path_to_active_v1_and_draft_v1_1(client_for, ai):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    ai(CLEAN, SIM, decisions=ScriptedDecisions({}))
    _final(api, p["id"])
    run = _lab(api, p["id"])
    assert run["critical_count"] == 0
    assert _blockers(api, p["id"]) == set()

    v = _draft(api, p["id"])
    author = client_for("au@example.org", ["author"])
    assert (
        author.post(
            f"/api/v1/personas/{p['id']}/activate", json={"version_id": v["id"]}
        ).status_code
        == 403
    )

    r = api.post(f"/api/v1/personas/{p['id']}/activate", json={"version_id": v["id"]})
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "active" and r.json()["label"] == "1.0"
    d = api.get(f"/api/v1/personas/{p['id']}").json()
    assert (
        d["status"] == "active"
        and d["active_version"]["label"] == "1.0"
        and d["draft_version"] is None
    )
    # После активации черновика нет, но прогоны v1.0 остаются актуальными для её содержимого.
    assert api.get(f"/api/v1/personas/{p['id']}/lab").json()["runs"][0]["is_current"] is True
    assert api.get(f"/api/v1/personas/{p['id']}/validations").json()[0]["is_current"] is True

    # Оператор теперь видит персону, но только активную версию.
    op = client_for("op@example.org", ["operator"])
    assert op.get(f"/api/v1/personas/{p['id']}").status_code == 200

    # Активная версия неизменна даже прямым SQL.
    with pytest.raises(DBAPIError):
        with get_engine().begin() as c:
            c.execute(
                text("UPDATE persona_versions SET content_hash = 'x' WHERE id = :i"), {"i": v["id"]}
            )

    # Следующий цикл — черновик v1.1; v1.0 остаётся активной до замены.
    r = api.post(f"/api/v1/personas/{p['id']}/versions")
    assert r.status_code == 201 and r.json()["label"] == "1.1"
    d = api.get(f"/api/v1/personas/{p['id']}").json()
    assert d["active_version"]["label"] == "1.0" and d["draft_version"]["label"] == "1.1"
    # Новый черновик требует свои проверки — старые относятся к v1.0.
    assert {"validation_missing", "lab_missing"} <= _blockers(api, p["id"])
    # Сравнение: базовый прогон лаборатории — у активной версии.
    assert api.get(f"/api/v1/personas/{p['id']}/lab").json()["baseline"]["version_label"] == "1.0"

    actions = [e["action"] for e in api.get(f"/api/v1/personas/{p['id']}/history").json()]
    assert "persona.activate" in actions and "persona.lab_done" in actions


def test_suspend_active_version(client_for, ai):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    ai(CLEAN, SIM, decisions=ScriptedDecisions({}))
    _final(api, p["id"])
    _lab(api, p["id"])
    v = _draft(api, p["id"])
    assert (
        api.post(f"/api/v1/personas/{p['id']}/activate", json={"version_id": v["id"]}).status_code
        == 200
    )
    r = api.post(
        f"/api/v1/personas/{p['id']}/versions/{v['id']}/suspend",
        json={"reason": "Найдена ошибка в легенде"},
    )
    assert (
        r.status_code == 200
        and r.json()["status"] == "suspended"
        and r.json()["active_version"] is None
    )
    hist = api.get(f"/api/v1/personas/{p['id']}/history").json()
    assert any(
        e["action"] == "persona.suspend" and e["details"]["reason"] == "Найдена ошибка в легенде"
        for e in hist
    )


def test_lab_results_immutable(client_for, ai):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    ai(SIM, judge(), decisions=ScriptedDecisions({"unc_money": "critical"}))
    run = _lab(api, p["id"])
    with pytest.raises(DBAPIError):
        with get_engine().begin() as c:
            c.execute(
                text("UPDATE persona_test_results SET verdict = 'pass' WHERE run_id = :i"),
                {"i": run["id"]},
            )
    with pytest.raises(DBAPIError):
        with get_engine().begin() as c:
            c.execute(
                text("UPDATE persona_test_runs SET critical_count = 0 WHERE id = :i"),
                {"i": run["id"]},
            )
