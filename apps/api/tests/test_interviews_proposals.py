"""Итерация 2: ИИ-интервью и очередь предложений.

Модель подменяется сценарным провайдером (без сети); всё остальное — настоящие API, БД и триггеры.
"""

import json

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.ai.client import Completion, set_provider_override
from app.db import get_engine

ROUND1 = {
    "questions": [
        {
            "question": "Чем персона зарабатывает на жизнь?",
            "why": "Профессия влияет на восприятие",
            "field_paths": ["legend.occupation"],
        },
        {
            "question": "Как она обычно проводит выходные?",
            "why": "Быт и увлечения",
            "field_paths": ["experience.hobbies"],
        },
        {
            "question": "Как реагирует на неполные сведения?",
            "why": "Поведение",
            "field_paths": ["behavior.on_incomplete_info"],
        },
    ]
}
PROCESS = {
    "proposals": [
        {
            "field_path": "legend.occupation",
            "value": "Механик в автосервисе",
            "certainty": "defined",
            "rationale": "Прямо из ответа редактора",
        },
        {
            "field_path": "experience.hobbies",
            "value": ["рыбалка", "футбол"],
            "certainty": "hypothesis",
            "rationale": "Следует из ответа",
            "related_paths": ["character.habits"],
        },
        {
            "field_path": "legend.full_name",
            "value": "Другое имя",
            "certainty": "hypothesis",
            "rationale": "Имя менять нельзя",
        },
    ],
    "next_questions": [
        {
            "question": "Есть ли у персоны дети?",
            "why": "Окружение",
            "field_paths": ["family.close_people"],
        },
        {
            "question": "Насколько формально она говорит?",
            "why": "Речь",
            "field_paths": ["speech.formality"],
        },
        {
            "question": "Чего она точно не знает?",
            "why": "Границы",
            "field_paths": ["competence.knowledge_limits"],
        },
    ],
}


class ScriptedLLM:
    model = "scripted-test-model"

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []

    def complete(self, messages):
        self.calls.append(messages)
        reply = self.replies.pop(0)
        return Completion(
            text=reply if isinstance(reply, str) else json.dumps(reply, ensure_ascii=False),
            model=self.model,
            prompt_tokens=100,
            completion_tokens=50,
        )


@pytest.fixture
def llm():
    holder = {}

    def _set(*replies):
        holder["p"] = ScriptedLLM(*replies)
        set_provider_override(holder["p"])
        return holder["p"]

    yield _set
    set_provider_override(None)


def _persona(api):
    r = api.post(
        "/api/v1/personas",
        json={
            "display_name": "Артем Тестовый",
            "short_context": "Гараж",
            "mode": "legend",
            "legend_text": "Обычный мужик, гараж, рыбалка.",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def _draft(api, pid):
    d = api.get(f"/api/v1/personas/{pid}").json()
    return api.get(f"/api/v1/personas/{pid}/versions/{d['draft_version']['id']}").json()


def _round1(api, pid):
    r = api.post(f"/api/v1/personas/{pid}/interviews")
    assert r.status_code == 201, r.text
    return r.json()


def _answer_all(api, pid, interview):
    qs = [q for q in interview["questions"] if q["round_no"] == interview["rounds"]]
    answers = [
        {
            "question_id": qs[0]["id"],
            "kind": "answered",
            "text": "Работает механиком в автосервисе",
        },
        {"question_id": qs[1]["id"], "kind": "answered", "text": "Рыбалка, футбол по телевизору"},
        {"question_id": qs[2]["id"], "kind": "unknown"},
    ]
    return api.post(
        f"/api/v1/personas/{pid}/interviews/{interview['id']}/rounds", json={"answers": answers}
    )


def _count(sql):
    with get_engine().connect() as c:
        return c.execute(text(sql)).scalar()


def test_without_llm_interview_is_honestly_unavailable(client_for):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    assert api.get(f"/api/v1/personas/{p['id']}").json()["ai_configured"] is False
    r = api.post(f"/api/v1/personas/{p['id']}/interviews")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "llm_not_configured"
    assert _count("SELECT count(*) FROM persona_interview_sessions") == 0


def test_interview_round_creates_proposals_without_touching_passport(client_for, llm):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    before = _draft(api, p["id"])
    provider = llm(ROUND1, PROCESS)

    interview = _round1(api, p["id"])
    assert interview["rounds"] == 1 and len(interview["questions"]) == 3
    # Легенда передана модели как данные, отдельно от инструкций.
    assert "<legend>" in provider.calls[0][1]["content"]

    r = _answer_all(api, p["id"], interview)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["proposals_created"] == 2  # имя (locked) отброшено
    assert body["interview"]["rounds"] == 2 and body["interview"]["status"] == "active"

    after = _draft(api, p["id"])
    assert after["content_hash"] == before["content_hash"]  # ИИ ничего не записал
    props = api.get(f"/api/v1/personas/{p['id']}/proposals").json()
    assert {x["field_path"] for x in props} == {"legend.occupation", "experience.hobbies"}
    occ = next(x for x in props if x["field_path"] == "legend.occupation")
    assert occ["before_value"] is None and occ["status"] == "pending"
    assert occ["generator"]["model"] == "scripted-test-model"
    assert api.get(f"/api/v1/personas/{p['id']}").json()["pending_proposals"] == 2
    assert _count("SELECT count(*) FROM ai_runs WHERE status = 'ok'") == 2


def test_accept_applies_value_with_provenance_and_audit(client_for, llm):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    llm(ROUND1, PROCESS)
    _answer_all(api, p["id"], _round1(api, p["id"]))
    props = {x["field_path"]: x for x in api.get(f"/api/v1/personas/{p['id']}/proposals").json()}
    v = _draft(api, p["id"])

    r = api.post(
        f"/api/v1/personas/{p['id']}/proposals/{props['experience.hobbies']['id']}/accept",
        json={"expected_revision": v["revision"]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["proposal"]["status"] == "accepted"
    v2 = _draft(api, p["id"])
    fld = v2["passport"]["sections"]["experience"]["fields"]["hobbies"]
    assert fld["value"] == ["рыбалка", "футбол"]
    assert fld["source_kind"] == "ai_suggestion"
    assert fld["certainty"] == "hypothesis"  # гипотеза не стала фактом
    assert fld["editor_approved"] is True
    assert "character.habits" in fld["dependencies"]
    assert v2["revision"] == v["revision"] + 1 and v2["content_hash"] != v["content_hash"]

    # Правка редактора перед принятием: исходное предложение сохраняется отдельно.
    r = api.post(
        f"/api/v1/personas/{p['id']}/proposals/{props['legend.occupation']['id']}/accept",
        json={
            "expected_revision": v2["revision"],
            "value": "Слесарь",
            "certainty": "hypothesis",
            "note": "уточнил",
        },
    )
    assert r.status_code == 200, r.text
    pr = r.json()["proposal"]
    assert pr["proposed_value"] == "Механик в автосервисе" and pr["edited_value"] == "Слесарь"
    occ = _draft(api, p["id"])["passport"]["sections"]["legend"]["fields"]["occupation"]
    assert occ["value"] == "Слесарь" and occ["source_kind"] == "editor"

    actions = [e["action"] for e in api.get(f"/api/v1/personas/{p['id']}/history").json()]
    assert actions.count("persona.proposal_accept") == 2
    assert "persona.interview_round" in actions and "persona.interview_start" in actions


def test_manual_edit_makes_proposal_stale(client_for, llm):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    llm(ROUND1, PROCESS)
    _answer_all(api, p["id"], _round1(api, p["id"]))
    props = {x["field_path"]: x for x in api.get(f"/api/v1/personas/{p['id']}/proposals").json()}

    v = _draft(api, p["id"])
    passport = v["passport"]
    passport["sections"]["legend"]["fields"]["occupation"] = {
        "value": "Водитель",
        "certainty": "defined",
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

    stale = api.get(f"/api/v1/personas/{p['id']}/proposals?status=stale").json()
    assert [x["field_path"] for x in stale] == ["legend.occupation"]
    # Предложение по другому полю осталось действующим.
    assert [x["field_path"] for x in api.get(f"/api/v1/personas/{p['id']}/proposals").json()] == [
        "experience.hobbies"
    ]

    v2 = _draft(api, p["id"])
    r = api.post(
        f"/api/v1/personas/{p['id']}/proposals/{props['legend.occupation']['id']}/accept",
        json={"expected_revision": v2["revision"]},
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "proposal_stale"
    r = api.post(
        f"/api/v1/personas/{p['id']}/proposals/{props['legend.occupation']['id']}/reject",
        json={"note": "уже решено"},
    )
    assert r.status_code == 200 and r.json()["status"] == "rejected"


def test_accept_with_outdated_revision_conflicts(client_for, llm):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    llm(ROUND1, PROCESS)
    _answer_all(api, p["id"], _round1(api, p["id"]))
    pr = api.get(f"/api/v1/personas/{p['id']}/proposals").json()[0]
    v = _draft(api, p["id"])
    r = api.post(
        f"/api/v1/personas/{p['id']}/proposals/{pr['id']}/accept",
        json={"expected_revision": v["revision"] + 5},
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "revision_conflict"
    assert api.get(f"/api/v1/personas/{p['id']}/proposals").json()[0]["status"] == "pending"


def test_rights_operator_admin_author(client_for, llm, make_user):
    editor = client_for("ed@example.org", ["editor"])
    p = _persona(editor)
    llm(ROUND1, PROCESS)
    _answer_all(editor, p["id"], _round1(editor, p["id"]))
    pr = editor.get(f"/api/v1/personas/{p['id']}/proposals").json()[0]
    v = _draft(editor, p["id"])

    admin = client_for("adm@example.org", ["admin"])
    assert admin.get(f"/api/v1/personas/{p['id']}/proposals").status_code == 200  # читать может
    assert admin.post(f"/api/v1/personas/{p['id']}/interviews").status_code == 403
    r = admin.post(
        f"/api/v1/personas/{p['id']}/proposals/{pr['id']}/accept",
        json={"expected_revision": v["revision"]},
    )
    assert r.status_code == 403

    operator = client_for("op@example.org", ["operator"])
    assert operator.get(f"/api/v1/personas/{p['id']}/proposals").status_code == 403

    # Автор правит любые черновики (решение владельца Q-002) — значит, и решает по предложениям.
    author = client_for("au@example.org", ["author"])
    r = author.post(
        f"/api/v1/personas/{p['id']}/proposals/{pr['id']}/accept",
        json={"expected_revision": v["revision"]},
    )
    assert r.status_code == 200, r.text


def test_invalid_model_output_is_retried_then_reported(client_for, llm):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    provider = llm(
        "это не json", {"questions": [{"question": "Один?", "field_paths": ["legend.occupation"]}]}
    )
    r = api.post(f"/api/v1/personas/{p['id']}/interviews")
    assert r.status_code == 502 and r.json()["error"]["code"] == "llm_failed"
    assert len(provider.calls) == 2  # повтор с указанием ошибки
    assert "не прошёл проверку" in provider.calls[1][-1]["content"]
    assert _count("SELECT count(*) FROM persona_interview_sessions") == 0
    assert _count("SELECT count(*) FROM ai_runs WHERE status = 'error'") == 1


def test_finish_early_and_skip_only_round(client_for, llm):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    provider = llm(ROUND1)
    interview = _round1(api, p["id"])
    answers = [{"question_id": q["id"], "kind": "skipped"} for q in interview["questions"]]
    r = api.post(
        f"/api/v1/personas/{p['id']}/interviews/{interview['id']}/rounds",
        json={"answers": answers, "finish": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["interview"]["status"] == "completed" and r.json()["proposals_created"] == 0
    assert len(provider.calls) == 1  # все вопросы пропущены — модель не вызывается

    # Незаполненный раунд отклоняется.
    llm(ROUND1)
    interview = _round1(api, p["id"])
    r = api.post(
        f"/api/v1/personas/{p['id']}/interviews/{interview['id']}/rounds",
        json={"answers": [{"question_id": interview["questions"][0]["id"], "kind": "skipped"}]},
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "answers_incomplete"
    r = api.post(f"/api/v1/personas/{p['id']}/interviews/{interview['id']}/complete")
    assert r.status_code == 200
    assert {q["answer_kind"] for q in r.json()["questions"]} == {"skipped"}


def test_deepen_keeps_only_requested_section(client_for, llm):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    llm(
        {
            "proposals": [
                {
                    "field_path": "character.traits",
                    "value": ["прямолинейный"],
                    "certainty": "hypothesis",
                    "rationale": "Из легенды",
                },
                {
                    "field_path": "character.narrative",
                    "value": "Говорит прямо, не любит долгих объяснений.",
                    "certainty": "hypothesis",
                    "rationale": "Связный нарратив",
                },
                {
                    "field_path": "speech.humor",
                    "value": "грубоватый",
                    "certainty": "hypothesis",
                    "rationale": "Не тот раздел",
                },
            ]
        }
    )
    r = api.post(f"/api/v1/personas/{p['id']}/proposals/deepen", json={"section": "character"})
    assert r.status_code == 201, r.text
    assert sorted(x["field_path"] for x in r.json()) == ["character.narrative", "character.traits"]

    narr = next(x for x in r.json() if x["field_path"] == "character.narrative")
    v = _draft(api, p["id"])
    assert (
        api.post(
            f"/api/v1/personas/{p['id']}/proposals/{narr['id']}/accept",
            json={"expected_revision": v["revision"]},
        ).status_code
        == 200
    )
    assert _draft(api, p["id"])["passport"]["sections"]["character"]["narrative"].startswith(
        "Говорит прямо"
    )


def test_db_guards_original_proposal_and_decisions(client_for, llm):
    api = client_for("ed@example.org", ["editor"])
    p = _persona(api)
    llm(ROUND1, PROCESS)
    _answer_all(api, p["id"], _round1(api, p["id"]))
    pr = api.get(f"/api/v1/personas/{p['id']}/proposals").json()[0]

    with pytest.raises(DBAPIError):
        with get_engine().begin() as c:
            c.execute(
                text(
                    "UPDATE persona_change_proposals SET proposed_value = '\"взлом\"' WHERE id = :i"
                ),
                {"i": pr["id"]},
            )

    api.post(f"/api/v1/personas/{p['id']}/proposals/{pr['id']}/reject", json={})
    with pytest.raises(DBAPIError):
        with get_engine().begin() as c:
            c.execute(
                text("UPDATE persona_change_proposals SET status = 'accepted' WHERE id = :i"),
                {"i": pr["id"]},
            )


def test_tolerant_parsing_keeps_good_items():
    from app.ai.interviewer import ProcessOut, RoundOut

    out = ProcessOut.model_validate(
        {
            "proposals": [
                {"field_path": "legend.occupation", "value": "Механик", "rationale": "x" * 2000},
                {"field_path": "legend.occupation", "value": None, "rationale": "пустое"},
                {"field_path": "nope.field", "value": "x", "rationale": "неизвестное поле"},
            ]
            + [
                {"field_path": "character.narrative", "value": f"Текст {i}", "rationale": "годится"}
                for i in range(20)
            ],
            "next_questions": [{"question": "Один вопрос?", "field_paths": ["legend.age_range"]}],
        }
    )
    assert len(out.proposals) == 12  # обрезано до лимита
    assert len(out.proposals[0].rationale) == 800
    assert out.next_questions == []  # меньше 3 вопросов — раунд не продолжается
    rnd = RoundOut.model_validate(
        {
            "questions": [
                {
                    "question": f"Вопрос номер {i}?",
                    "why": "w" * 900,
                    "field_paths": ["legend.age_range", "bad.path"] + ["legend.geography"] * 9,
                }
                for i in range(7)
            ]
        }
    )
    assert len(rnd.questions) == 5 and len(rnd.questions[0].why) == 400
    assert "bad.path" not in rnd.questions[0].field_paths and len(rnd.questions[0].field_paths) <= 8
