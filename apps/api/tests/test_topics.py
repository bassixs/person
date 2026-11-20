"""Итерация 3: темы — досье, утверждения с источниками, права, утверждение, версии, пометки."""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db import get_engine

SRC = {
    "title": "Сайт администрации",
    "url": "https://example.org/news/1",
    "quote": "Работы до 25 ноября",
}


def _topic(api, **kw):
    body = {"title": "Ремонт моста на Лесной", "geography": "Северный район", "category": "дороги"}
    body.update(kw)
    r = api.post("/api/v1/topics", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _draft(api, tid):
    t = api.get(f"/api/v1/topics/{tid}").json()
    return api.get(f"/api/v1/topics/{tid}/versions/{t['draft_version']['id']}").json()


def _save(api, tid, v, **dossier):
    d = dict(v["dossier"])
    d.update(dossier)
    return api.put(
        f"/api/v1/topics/{tid}/versions/{v['id']}",
        json={"dossier": d, "expected_revision": v["revision"]},
    )


def _claim(text_, status="unverified", sources=None, **kw):
    c = {"id": str(uuid.uuid4()), "text": text_, "status": status, "sources": sources or []}
    c.update(kw)
    return c


def test_create_and_edit_dossier_persists(client_for):
    api = client_for("au@example.org", ["author"])
    t = _topic(api, summary="")
    assert t["status"] == "draft" and t["draft_version"]["label"] == "1.0"
    v = _draft(api, t["id"])
    r = _save(
        api,
        t["id"],
        v,
        summary="Ремонт моста, движение перекрыто.",
        participants=["подрядчик", "администрация"],
        unknowns=["точная дата открытия"],
        claims=[_claim("Работы завершатся 25 ноября", sources=[SRC], kind="operational")],
    )
    assert r.status_code == 200, r.text
    again = _draft(api, t["id"])
    assert again["dossier"]["summary"].startswith("Ремонт моста")
    assert again["dossier"]["claims"][0]["origin"] == "editor"
    assert again["revision"] == v["revision"] + 1
    # Оптимистичная блокировка.
    assert _save(api, t["id"], v, summary="старое").status_code == 409
    lst = api.get("/api/v1/topics", params={"q": "мост"}).json()
    assert lst["total"] == 1 and lst["items"][0]["counts"]["claims"] == 1


def test_author_cannot_verify_or_refute(client_for):
    au = client_for("au@example.org", ["author"])
    t = _topic(au)
    v = _draft(au, t["id"])
    r = _save(au, t["id"], v, claims=[_claim("Мост закрыт", status="verified", sources=[SRC])])
    assert r.status_code == 403
    r = _save(au, t["id"], v, claims=[_claim("Мост закрыт", status="refuted")])
    assert r.status_code == 403
    # «Спорно» автор поставить может — сомнение безопасно.
    assert (
        _save(au, t["id"], v, claims=[_claim("Мост закрыт", status="disputed")]).status_code == 200
    )


def test_verified_requires_source_and_edit_drops_verification(client_for):
    ed = client_for("ed@example.org", ["editor"])
    t = _topic(ed, summary="Суть")
    v = _draft(ed, t["id"])
    r = _save(ed, t["id"], v, claims=[_claim("Без источника", status="verified")])
    assert r.status_code == 422 and r.json()["error"]["code"] == "claim_source_required"
    c = _claim("Работы завершатся 25 ноября", status="verified", sources=[SRC])
    r = _save(ed, t["id"], v, claims=[c])
    assert r.status_code == 200
    saved = r.json()["version"]["dossier"]["claims"][0]
    assert saved["checked_at"] is not None

    # Автор меняет текст подтверждённого — подтверждение снимается сервером.
    au = client_for("au@example.org", ["author"])
    v2 = _draft(au, t["id"])
    changed = dict(v2["dossier"]["claims"][0], text="Работы завершатся 30 ноября")
    r = _save(au, t["id"], v2, claims=[changed])
    assert r.status_code == 200
    assert r.json()["version"]["dossier"]["claims"][0]["status"] == "unverified"
    assert r.json()["notes"]


def test_activation_rules_and_versions(client_for):
    ed = client_for("ed@example.org", ["editor"])
    t = _topic(ed)
    v = _draft(ed, t["id"])
    r = ed.post(f"/api/v1/topics/{t['id']}/activate", json={"version_id": v["id"]})
    assert r.status_code == 409 and "summary_missing" in {
        b["code"] for b in r.json()["error"]["details"]
    }
    hist = [e["action"] for e in ed.get(f"/api/v1/topics/{t['id']}/history").json()]
    assert "topic.activate_rejected" in hist

    claim = _claim(
        "Работы завершатся 25 ноября", status="verified", sources=[SRC], kind="operational"
    )
    assert _save(ed, t["id"], v, summary="Ремонт моста", claims=[claim]).status_code == 200
    chk = ed.get(
        f"/api/v1/topics/{t['id']}/activation-check", params={"version_id": v["id"]}
    ).json()
    assert chk["blockers"] == [] and "operational_no_review_date" in {
        w["code"] for w in chk["warnings"]
    }

    # Автор отправляет, но утвердить не может; оператор и админ без роли редактора — тоже.
    au = client_for("au@example.org", ["author"])
    op = client_for("op@example.org", ["operator"])
    assert (
        au.post(f"/api/v1/topics/{t['id']}/submit", json={"version_id": v["id"]}).json()["status"]
        == "under_review"
    )
    for c in (au, op, client_for("ad@example.org", ["admin"])):
        r = c.post(f"/api/v1/topics/{t['id']}/activate", json={"version_id": v["id"]})
        assert r.status_code in (403, 404)

    # Редактор утверждает собственную работу.
    r = ed.post(f"/api/v1/topics/{t['id']}/activate", json={"version_id": v["id"]})
    assert r.status_code == 200 and r.json()["label"] == "1.0"
    d = ed.get(f"/api/v1/topics/{t['id']}").json()
    assert d["status"] == "active" and d["draft_version"] is None

    # Оператор видит только активную версию.
    assert op.get(f"/api/v1/topics/{t['id']}").status_code == 200
    assert op.get("/api/v1/topics").json()["total"] == 1

    # Активная версия неизменна даже прямым SQL.
    with pytest.raises(DBAPIError):
        with get_engine().begin() as c:
            c.execute(
                text("UPDATE topic_versions SET dossier = '{}' WHERE id = :i"), {"i": v["id"]}
            )

    # Черновик 1.1 от активной; 1.0 остаётся активной.
    r = ed.post(f"/api/v1/topics/{t['id']}/versions")
    assert r.status_code == 201 and r.json()["label"] == "1.1"
    d = ed.get(f"/api/v1/topics/{t['id']}").json()
    assert d["active_version"]["label"] == "1.0" and d["draft_version"]["label"] == "1.1"
    # Оператор черновик не видит.
    assert (
        op.get(f"/api/v1/topics/{t['id']}/versions/{d['draft_version']['id']}").status_code == 404
    )


def test_claim_flag_marks_unsafe_without_rewriting_version(client_for):
    ed = client_for("ed@example.org", ["editor"])
    t = _topic(ed)
    v = _draft(ed, t["id"])
    claim = _claim(
        "Работы завершатся 25 ноября", status="verified", sources=[SRC], valid_until="2099-01-01"
    )
    _save(ed, t["id"], v, summary="Ремонт", claims=[claim])
    ed.post(f"/api/v1/topics/{t['id']}/activate", json={"version_id": v["id"]})

    au = client_for("au@example.org", ["author"])
    r = au.post(
        f"/api/v1/topics/{t['id']}/claim-flags",
        json={"claim_id": claim["id"], "flag": "refuted", "reason": "Новый срок"},
    )
    assert r.status_code == 403

    r = ed.post(
        f"/api/v1/topics/{t['id']}/claim-flags",
        json={"claim_id": claim["id"], "flag": "refuted", "reason": "Подрядчик сообщил о переносе"},
    )
    assert r.status_code == 201
    d = ed.get(f"/api/v1/topics/{t['id']}").json()
    assert d["status"] == "needs_update" and d["counts"]["unsafe"] == 1 and len(d["flags"]) == 1
    av = ed.get(f"/api/v1/topics/{t['id']}/versions/{v['id']}").json()
    assert av["dossier"]["claims"][0]["status"] == "verified"  # версия не переписана
    assert av["claims_effective"][0] == {
        **av["claims_effective"][0],
        "effective_status": "refuted",
        "safe_to_use": False,
    }

    # Новый черновик с тем же утверждением «подтверждено» не утвердить, пока пометка действует.
    nv = ed.post(f"/api/v1/topics/{t['id']}/versions").json()
    r = ed.post(f"/api/v1/topics/{t['id']}/activate", json={"version_id": nv["id"]})
    assert r.status_code == 409 and "flag_unresolved" in {
        b["code"] for b in r.json()["error"]["details"]
    }

    # Журнал пометок — только добавление.
    with pytest.raises(DBAPIError):
        with get_engine().begin() as c:
            c.execute(text("DELETE FROM topic_claim_flags WHERE topic_id = :i"), {"i": t["id"]})

    r = ed.post(
        f"/api/v1/topics/{t['id']}/claim-flags",
        json={"claim_id": claim["id"], "flag": "cleared", "reason": "Перенос не подтвердился"},
    )
    assert r.status_code == 201
    assert ed.get(f"/api/v1/topics/{t['id']}").json()["status"] == "active"
    hist = ed.get(f"/api/v1/topics/{t['id']}/claims/{claim['id']}/history").json()
    assert [h["kind"] for h in hist].count("flag") == 2 and any(
        h["kind"] == "version" for h in hist
    )


def test_expired_claim_is_not_safe(client_for):
    ed = client_for("ed@example.org", ["editor"])
    t = _topic(ed)
    v = _draft(ed, t["id"])
    claim = _claim(
        "Перекрытие до 1 ноября", status="verified", sources=[SRC], valid_until="2020-11-01"
    )
    r = _save(ed, t["id"], v, summary="Ремонт", claims=[claim])
    eff = r.json()["version"]["claims_effective"][0]
    assert eff["effective_status"] == "stale" and eff["safe_to_use"] is False


def test_suspend_and_archive(client_for):
    ed = client_for("ed@example.org", ["editor"])
    t = _topic(ed, summary="Суть")
    v = _draft(ed, t["id"])
    assert (
        ed.post(f"/api/v1/topics/{t['id']}/activate", json={"version_id": v["id"]}).status_code
        == 200
    )
    r = ed.post(
        f"/api/v1/topics/{t['id']}/versions/{v['id']}/suspend",
        json={"reason": "Ошибочные сведения"},
    )
    assert (
        r.status_code == 200
        and r.json()["status"] == "suspended"
        and r.json()["active_version"] is None
    )
    au = client_for("au@example.org", ["author"])
    assert au.post(f"/api/v1/topics/{t['id']}/archive").status_code == 403
    assert ed.post(f"/api/v1/topics/{t['id']}/archive").json()["status"] == "archived"
    assert ed.get("/api/v1/topics").json()["total"] == 0
    assert ed.post(f"/api/v1/topics/{t['id']}/unarchive").json()["status"] == "suspended"
