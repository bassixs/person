"""Итерация 3: карточка понимания темы (§8.4) — сверка цитат, актуальность, перенос в черновик."""

import json

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.ai.client import Completion, set_provider_override
from app.db import get_engine

MATERIAL = (
    "Подрядчик сообщил: работы на мосту по Лесной улице завершатся 25 ноября. Объезд по Садовой."
)

CARD = {
    "summary": "Ремонт моста на Лесной, объезд по Садовой.",
    "known_facts": [
        {
            "text": "Работы завершатся 25 ноября",
            "refs": [
                {"material": "M1", "quote": "работы на мосту по Лесной улице завершатся 25 ноября"}
            ],
        },
        {
            "text": "Мост откроют для грузовиков",
            "refs": [{"material": "M1", "quote": "мост откроют для грузовиков"}],
        },
        {"text": "Есть второй документ", "refs": [{"material": "M9", "quote": "что угодно"}]},
    ],
    "unverified_claims": [{"text": "Автобус 12 пойдёт по объезду", "reason": "в материалах нет"}],
    "conflicts": [],
    "open_questions": ["Когда вернут автобус?"],
    "gaps": ["Нет документа подрядчика"],
    "understood": True,
    "understood_reason": "Суть понятна из сообщения подрядчика",
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


@pytest.fixture
def llm():
    def _set(*replies):
        x = ScriptedLLM(*replies)
        set_provider_override(x)
        return x

    yield _set
    set_provider_override(None)


def _setup(api):
    t = api.post("/api/v1/topics", json={"title": "Ремонт моста", "summary": "Мост закрыт"}).json()
    item = api.post(
        "/api/v1/knowledge/texts",
        json={
            "title": "Сообщение подрядчика",
            "text": MATERIAL,
            "layer": "topic",
            "topic_ids": [t["id"]],
        },
    ).json()
    return t, item


def _run(api, tid):
    r = api.post(f"/api/v1/topics/{tid}/understanding")
    assert r.status_code == 202, r.text
    return api.get(f"/api/v1/topics/{tid}/understanding/{r.json()['id']}").json()


def _warnings(api, tid):
    t = api.get(f"/api/v1/topics/{tid}").json()
    chk = api.get(
        f"/api/v1/topics/{tid}/activation-check", params={"version_id": t["draft_version"]["id"]}
    ).json()
    return {w["code"] for w in chk["warnings"]}


def test_unavailable_without_llm(client_for):
    api = client_for("ed@example.org", ["editor"])
    t, _ = _setup(api)
    assert api.get(f"/api/v1/topics/{t['id']}/understanding").json()["available"] is False
    r = api.post(f"/api/v1/topics/{t['id']}/understanding")
    assert r.status_code == 503 and r.json()["error"]["code"] == "llm_not_configured"


def test_card_quotes_verified_against_material(client_for, llm):
    api = client_for("ed@example.org", ["editor"])
    t, item = _setup(api)
    assert "understanding_missing" in _warnings(api, t["id"])
    m = llm(CARD)
    run = _run(api, t["id"])
    assert run["status"] == "done" and run["is_current"] is True
    facts = run["card"]["known_facts"]
    assert facts[0]["refs"][0] == {
        "item_id": item["id"],
        "title": "Сообщение подрядчика",
        "quote": "работы на мосту по Лесной улице завершатся 25 ноября",
        "quote_found": True,
    }
    assert facts[1]["refs"][0]["quote_found"] is False  # модель «процитировала» то, чего нет
    assert facts[2]["refs"] == []  # ссылка на несуществующий материал отброшена
    prompt = m.calls[0][1]["content"]
    assert MATERIAL in prompt and "<<<M1" in prompt
    assert "ДАННЫЕ" in m.calls[0][0]["content"]
    assert "understanding_missing" not in _warnings(api, t["id"])

    # Новый материал делает карточку неактуальной.
    api.post(
        "/api/v1/knowledge/texts",
        json={
            "title": "Ещё",
            "text": "Дополнительное сообщение о мосте.",
            "layer": "topic",
            "topic_ids": [t["id"]],
        },
    )
    ov = api.get(f"/api/v1/topics/{t['id']}/understanding").json()
    assert ov["latest"]["is_current"] is False and ov["materials_count"] == 2
    assert "understanding_missing" in _warnings(api, t["id"])


def test_apply_items_to_draft(client_for, llm):
    ed = client_for("ed@example.org", ["editor"])
    t, item = _setup(ed)
    llm(CARD)
    run = _run(ed, t["id"])
    au = client_for("au@example.org", ["author"])
    url = f"/api/v1/topics/{t['id']}/understanding/{run['id']}/apply"
    assert au.post(url, json={"kind": "fact", "index": 0}).status_code == 200
    assert au.post(url, json={"kind": "fact", "index": 0}).status_code == 409
    assert au.post(url, json={"kind": "fact", "index": 1}).status_code == 200
    assert au.post(url, json={"kind": "question", "index": 0}).status_code == 200
    assert au.post(url, json={"kind": "gap", "index": 0}).status_code == 200
    assert au.post(url, json={"kind": "unverified", "index": 0}).status_code == 200

    d = au.get(f"/api/v1/topics/{t['id']}").json()
    v = au.get(f"/api/v1/topics/{t['id']}/versions/{d['draft_version']['id']}").json()
    claims = v["dossier"]["claims"]
    assert all(c["status"] == "unverified" and c["origin"] == "ai_suggestion" for c in claims)
    assert claims[0]["sources"][0]["knowledge_item_id"] == item["id"]
    assert claims[0]["sources"][0]["quote"].startswith("работы на мосту")
    assert claims[1]["sources"][0]["quote"] is None  # ненайденная цитата не прикрепляется
    assert v["dossier"]["residents_questions"] == ["Когда вернут автобус?"]
    assert v["dossier"]["unknowns"] == ["Нет документа подрядчика"]
    # Перенос изменил досье — карточка больше не актуальна.
    assert au.get(f"/api/v1/topics/{t['id']}/understanding").json()["latest"]["is_current"] is False

    op = client_for("op@example.org", ["operator"])
    assert op.get(f"/api/v1/topics/{t['id']}/understanding").status_code in (403, 404)


def test_failed_run_and_immutability(client_for, llm):
    api = client_for("ed@example.org", ["editor"])
    t, _ = _setup(api)
    llm("не json", "снова не json")
    run = _run(api, t["id"])
    assert run["status"] == "failed" and run["error"]
    llm(CARD)
    run = _run(api, t["id"])
    with pytest.raises(DBAPIError):
        with get_engine().begin() as c:
            c.execute(
                text("UPDATE topic_understanding_runs SET card = '{}' WHERE id = :i"),
                {"i": run["id"]},
            )
