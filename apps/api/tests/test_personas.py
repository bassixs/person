import copy

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db import get_engine


def _create(api, **kw):
    body = {"display_name": "Ирина Тестова", "short_context": "Контекст", **kw}
    r = api.post("/api/v1/personas", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _draft(api, pid):
    d = api.get(f"/api/v1/personas/{pid}").json()
    return api.get(f"/api/v1/personas/{pid}/versions/{d['draft_version']['id']}").json()


def test_schema_has_nine_sections(client_for):
    api = client_for("ed@example.org", ["editor"])
    s = api.get("/api/v1/personas/schema").json()
    assert len(s["sections"]) == 9
    assert set(s["certainties"]) == {"defined", "hypothesis", "unknown"}


def test_create_and_persist_passport(client_for):
    """DoD-1: создать → сохранить поля и нарратив → перечитать → данные на месте."""
    api = client_for("ed@example.org", ["editor"])
    persona = _create(api)
    assert persona["status"] == "draft"
    assert persona["draft_version"]["label"] == "1.0"
    assert persona["active_version"] is None

    v = _draft(api, persona["id"])
    passport = v["passport"]
    # Новый паспорт: всё неизвестно, кроме имени.
    assert passport["sections"]["family"]["fields"]["family_status"]["certainty"] == "unknown"
    passport["sections"]["legend"]["fields"]["occupation"] = {
        "value": "Учитель",
        "certainty": "hypothesis",
        "source_kind": "original_legend",
        "editor_approved": False,
        "dependencies": ["competence.knowledge_areas"],
    }
    passport["sections"]["character"]["fields"]["traits"]["value"] = ["спокойная", "внимательная"]
    passport["sections"]["character"]["fields"]["traits"]["certainty"] = "defined"
    passport["sections"]["legend"]["narrative"] = "Длинное описание жизненной ситуации."
    r = api.put(
        f"/api/v1/personas/{persona['id']}/versions/{v['id']}",
        json={"passport": passport, "expected_revision": v["revision"]},
    )
    assert r.status_code == 200, r.text
    saved = r.json()
    assert saved["revision"] == v["revision"] + 1
    assert saved["content_hash"] != v["content_hash"]

    again = _draft(api, persona["id"])
    occ = again["passport"]["sections"]["legend"]["fields"]["occupation"]
    assert occ["value"] == "Учитель"
    # Сервер принудительно ставит происхождение «editor» для ручной правки.
    assert occ["source_kind"] == "editor"
    assert occ["dependencies"] == ["competence.knowledge_areas"]
    assert again["passport"]["sections"]["legend"]["narrative"].startswith("Длинное")
    assert again["completeness"]["fields_filled"] == 3


def test_editor_cannot_forge_ai_provenance_on_unchanged_field(client_for):
    api = client_for("ed@example.org", ["editor"])
    persona = _create(api)
    v = _draft(api, persona["id"])
    p = copy.deepcopy(v["passport"])
    p["sections"]["legend"]["fields"]["full_name"]["source_kind"] = "ai_suggestion"
    r = api.put(
        f"/api/v1/personas/{persona['id']}/versions/{v['id']}",
        json={"passport": p, "expected_revision": v["revision"]},
    )
    assert r.status_code == 200
    assert (
        r.json()["passport"]["sections"]["legend"]["fields"]["full_name"]["source_kind"] == "editor"
    )


def test_value_with_unknown_certainty_rejected(client_for):
    api = client_for("ed@example.org", ["editor"])
    persona = _create(api)
    v = _draft(api, persona["id"])
    p = v["passport"]
    p["sections"]["legend"]["fields"]["occupation"] = {"value": "X", "certainty": "unknown"}
    r = api.put(
        f"/api/v1/personas/{persona['id']}/versions/{v['id']}",
        json={"passport": p, "expected_revision": v["revision"]},
    )
    assert r.status_code == 422


def test_bad_dependency_and_unknown_field_rejected(client_for):
    api = client_for("ed@example.org", ["editor"])
    persona = _create(api)
    v = _draft(api, persona["id"])
    p = copy.deepcopy(v["passport"])
    p["sections"]["legend"]["fields"]["occupation"]["dependencies"] = ["nope.field"]
    r = api.put(
        f"/api/v1/personas/{persona['id']}/versions/{v['id']}",
        json={"passport": p, "expected_revision": v["revision"]},
    )
    assert r.status_code == 422
    p = copy.deepcopy(v["passport"])
    p["sections"]["legend"]["fields"]["hacked"] = {"value": "x", "certainty": "defined"}
    r = api.put(
        f"/api/v1/personas/{persona['id']}/versions/{v['id']}",
        json={"passport": p, "expected_revision": v["revision"]},
    )
    assert r.status_code == 422


def test_optimistic_lock_conflict(client_for):
    api = client_for("ed@example.org", ["editor"])
    persona = _create(api)
    v = _draft(api, persona["id"])
    p = v["passport"]
    p["sections"]["legend"]["narrative"] = "Первая правка"
    url = f"/api/v1/personas/{persona['id']}/versions/{v['id']}"
    assert api.put(url, json={"passport": p, "expected_revision": v["revision"]}).status_code == 200
    p["sections"]["legend"]["narrative"] = "Устаревшая вкладка"
    r = api.put(url, json={"passport": p, "expected_revision": v["revision"]})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "revision_conflict"


def test_activation_blocked_without_checks_even_for_editor(client_for):
    """Барьер на backend: без актуальной проверки и лаборатории активация невозможна."""
    api = client_for("ed@example.org", ["editor"])
    persona = _create(api)
    vid = persona["draft_version"]["id"]
    r = api.post(f"/api/v1/personas/{persona['id']}/activate", json={"version_id": vid})
    assert r.status_code == 409
    codes = {b["code"] for b in r.json()["error"]["details"]}
    assert {"validation_missing", "lab_missing"} <= codes
    assert api.get(f"/api/v1/personas/{persona['id']}").json()["active_version"] is None
    audit = api.get("/api/v1/audit", params={"action": "persona.activate_rejected"}).json()
    assert audit["total"] == 1


def test_db_trigger_protects_non_draft_versions(client_for):
    """Даже прямой SQL не может изменить содержимое активной версии."""
    api = client_for("ed@example.org", ["editor"])
    persona = _create(api)
    vid = persona["draft_version"]["id"]
    with get_engine().begin() as conn:
        conn.execute(text("UPDATE persona_versions SET state='active' WHERE id=:v"), {"v": vid})
    with pytest.raises(DBAPIError), get_engine().begin() as conn:
        conn.execute(
            text("UPDATE persona_versions SET passport='{}'::jsonb WHERE id=:v"), {"v": vid}
        )
    with pytest.raises(DBAPIError), get_engine().begin() as conn:
        conn.execute(text("DELETE FROM persona_versions WHERE id=:v"), {"v": vid})
    # И API тоже отказывает в правке.
    v = api.get(f"/api/v1/personas/{persona['id']}/versions/{vid}").json()
    r = api.put(
        f"/api/v1/personas/{persona['id']}/versions/{vid}",
        json={"passport": v["passport"], "expected_revision": v["revision"]},
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "version_immutable"


def test_new_draft_from_active_keeps_active_intact(client_for):
    """DoD-5 (часть): v1.0 активна → черновик v1.1, правки не трогают v1.0."""
    api = client_for("ed@example.org", ["editor"])
    persona = _create(api)
    pid, vid = persona["id"], persona["draft_version"]["id"]
    # Активацию в итерации 1 моделируем напрямую в БД (проверок ещё нет).
    with get_engine().begin() as conn:
        conn.execute(text("UPDATE persona_versions SET state='active' WHERE id=:v"), {"v": vid})
        conn.execute(
            text("UPDATE personas SET active_version_id=:v, status='active' WHERE id=:p"),
            {"v": vid, "p": pid},
        )
    r = api.post(f"/api/v1/personas/{pid}/versions")
    assert r.status_code == 201
    draft = r.json()
    assert draft["label"] == "1.1" and draft["state"] == "draft"
    assert api.post(f"/api/v1/personas/{pid}/versions").status_code == 409  # второй черновик
    p = draft["passport"]
    p["sections"]["legend"]["narrative"] = "Изменение в 1.1"
    assert (
        api.put(
            f"/api/v1/personas/{pid}/versions/{draft['id']}",
            json={"passport": p, "expected_revision": draft["revision"]},
        ).status_code
        == 200
    )
    active = api.get(f"/api/v1/personas/{pid}/versions/{vid}").json()
    assert active["passport"]["sections"]["legend"]["narrative"] == ""
    assert active["state"] == "active"

    op = client_for("op@example.org", ["operator"])
    seen = op.get(f"/api/v1/personas/{pid}").json()
    assert [v["label"] for v in seen["versions"]] == ["1.0"]
    assert seen["draft_version"] is None
    assert op.get(f"/api/v1/personas/{pid}/versions/{draft['id']}").status_code == 404


def test_legend_mode_stores_immutable_legend(client_for):
    api = client_for("ed@example.org", ["editor"])
    r = api.post("/api/v1/personas", json={"display_name": "Икс", "mode": "legend"})
    assert r.status_code == 422
    persona = _create(api, mode="legend", legend_text="Краткая легенда")
    assert persona["source_materials"][0]["content"] == "Краткая легенда"
    v = _draft(api, persona["id"])
    assert (
        v["passport"]["sections"]["legend"]["fields"]["full_name"]["source_kind"]
        == "original_legend"
    )
    with pytest.raises(DBAPIError), get_engine().begin() as conn:
        conn.execute(text("UPDATE persona_source_materials SET content='подмена'"))


def test_ai_draft_honest_when_llm_missing(client_for):
    api = client_for("ed@example.org", ["editor"])
    r = api.post("/api/v1/personas", json={"display_name": "Икс", "mode": "ai_draft"})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "llm_not_configured"
    st = {i["name"]: i["status"] for i in api.get("/api/v1/integrations/status").json()}
    assert st == {"llm": "not_configured", "search": "not_configured", "max": "not_configured"}


def test_catalog_search_filter_sort_archive(client_for):
    api = client_for("ed@example.org", ["editor"])
    a = _create(api, display_name="Анна Рыбакова", short_context="рыбалка")
    _create(api, display_name="Борис Цветков", short_context="цветы")
    assert api.get("/api/v1/personas", params={"q": "рыбал"}).json()["total"] == 1
    names = [
        i["display_name"]
        for i in api.get("/api/v1/personas", params={"sort": "name_asc"}).json()["items"]
    ]
    assert names == ["Анна Рыбакова", "Борис Цветков"]
    assert api.post(f"/api/v1/personas/{a['id']}/archive").json()["status"] == "archived"
    assert api.get("/api/v1/personas").json()["total"] == 1
    assert api.get("/api/v1/personas", params={"status": "archived"}).json()["total"] == 1
    # В архиве править нельзя
    v = _draft(api, a["id"])
    r = api.put(
        f"/api/v1/personas/{a['id']}/versions/{v['id']}",
        json={"passport": v["passport"], "expected_revision": v["revision"]},
    )
    assert r.status_code == 409
    assert api.post(f"/api/v1/personas/{a['id']}/unarchive").json()["status"] == "draft"


def test_overview_reports_real_counts_only(client_for):
    api = client_for("ed@example.org", ["editor"])
    o = api.get("/api/v1/overview").json()
    assert o["personas"]["total"] == 0
    assert o["topics"]["available"] is False
    _create(api)
    o = api.get("/api/v1/overview").json()
    assert o["personas"]["total"] == 1 and o["personas"]["by_status"] == {"draft": 1}
    assert o["recent_events"][0]["action"] == "persona.create"


def test_seed_creates_seven_drafts_never_active(make_user, client_for):
    from app.cli import main

    make_user("seed@example.org", ["editor"])
    assert main(["seed-personas", "--as", "seed@example.org"]) == 2  # без --confirm
    assert main(["seed-personas", "--as", "seed@example.org", "--confirm"]) == 0
    assert main(["seed-personas", "--as", "seed@example.org", "--confirm"]) == 0  # идемпотентно
    api = client_for("ed@example.org", ["editor"])
    items = api.get("/api/v1/personas", params={"page_size": 50}).json()["items"]
    assert len(items) == 7
    assert all(i["status"] == "draft" and i["active_version"] is None for i in items)
    igor = next(i for i in items if i["display_name"] == "Игорь Давыдов")
    v = _draft(api, igor["id"])
    occ = v["passport"]["sections"]["legend"]["fields"]["occupation"]
    assert occ["source_kind"] == "original_legend" and occ["editor_approved"] is False
    assert v["passport"]["sections"]["character"]["fields"]["habits"]["certainty"] == "unknown"


def test_history_covers_persona_and_versions(client_for):
    api = client_for("ed@example.org", ["editor"])
    persona = _create(api)
    v = _draft(api, persona["id"])
    p = v["passport"]
    p["sections"]["legend"]["narrative"] = "Правка"
    api.put(
        f"/api/v1/personas/{persona['id']}/versions/{v['id']}",
        json={"passport": p, "expected_revision": v["revision"]},
    )
    actions = [e["action"] for e in api.get(f"/api/v1/personas/{persona['id']}/history").json()]
    assert actions == ["persona.edit", "persona.create"]
    op = client_for("op@example.org", ["operator"])
    assert op.get(f"/api/v1/personas/{persona['id']}/history").status_code == 403
