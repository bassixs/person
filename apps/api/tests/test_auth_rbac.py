from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import session_factory
from app.main import create_app
from app.models import AuditEvent
from tests.conftest import ApiClient


def test_health_and_ready():
    c = TestClient(create_app())
    assert c.get("/api/v1/health").json() == {"status": "ok"}
    r = c.get("/api/v1/ready")
    assert r.status_code == 200 and r.json()["migration"] == "0001"


def test_unauthenticated_is_rejected():
    c = TestClient(create_app())
    r = c.get("/api/v1/personas")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthenticated"


def test_login_wrong_password_and_audit(make_user):
    make_user("ed@example.org", ["editor"])
    api = ApiClient(TestClient(create_app()))
    r = api.login("ed@example.org", "wrong-password")
    assert r.status_code == 401
    with session_factory()() as db:
        assert db.scalar(select(AuditEvent).where(AuditEvent.action == "auth.login_failed"))


def test_login_sets_httponly_cookie_and_me(make_user):
    make_user("ed@example.org", ["editor"])
    api = ApiClient(TestClient(create_app()))
    r = api.login("ED@example.org")
    assert r.status_code == 200
    assert "httponly" in r.headers["set-cookie"].lower()
    me = api.get("/api/v1/auth/me").json()
    assert me["roles"] == ["editor"]
    assert "persona.activate" in me["permissions"]


def test_csrf_required_for_mutations(client_for):
    api = client_for("ed@example.org", ["editor"])
    r = api.c.post("/api/v1/personas", json={"display_name": "Тест"})  # без заголовка
    assert r.status_code == 403 and r.json()["error"]["code"] == "csrf_failed"


def test_logout_revokes_session(client_for):
    api = client_for("ed@example.org", ["editor"])
    assert api.post("/api/v1/auth/logout").status_code == 204
    api.c.cookies.clear()
    assert api.get("/api/v1/auth/me").status_code == 401


def test_login_rate_limited(make_user):
    make_user("ed@example.org", ["editor"])
    api = ApiClient(TestClient(create_app()))
    codes = [api.login("ed@example.org", "bad").status_code for _ in range(9)]
    assert codes[-1] == 429


def test_admin_cannot_create_or_activate_content(client_for):
    editor = client_for("ed@example.org", ["editor"])
    pid = editor.post("/api/v1/personas", json={"display_name": "Персона"}).json()["id"]
    vid = editor.get(f"/api/v1/personas/{pid}").json()["draft_version"]["id"]

    admin = client_for("admin@example.org", ["admin"])
    assert admin.post("/api/v1/personas", json={"display_name": "X"}).status_code == 403
    r = admin.post(f"/api/v1/personas/{pid}/activate", json={"version_id": vid})
    assert r.status_code == 403


def test_operator_cannot_see_drafts_or_activate(client_for):
    editor = client_for("ed@example.org", ["editor"])
    pid = editor.post("/api/v1/personas", json={"display_name": "Персона"}).json()["id"]
    vid = editor.get(f"/api/v1/personas/{pid}").json()["draft_version"]["id"]

    op = client_for("op@example.org", ["operator"])
    assert op.get("/api/v1/personas").json()["total"] == 0
    assert op.get(f"/api/v1/personas/{pid}").status_code == 404
    r = op.post(f"/api/v1/personas/{pid}/activate", json={"version_id": vid})
    assert r.status_code == 403


def test_author_cannot_activate_or_archive(client_for):
    author = client_for("au@example.org", ["author"])
    pid = author.post("/api/v1/personas", json={"display_name": "Персона"}).json()["id"]
    vid = author.get(f"/api/v1/personas/{pid}").json()["draft_version"]["id"]
    assert (
        author.post(f"/api/v1/personas/{pid}/activate", json={"version_id": vid}).status_code == 403
    )
    assert author.post(f"/api/v1/personas/{pid}/archive").status_code == 403


def test_user_management_admin_only(client_for):
    editor = client_for("ed@example.org", ["editor"])
    assert editor.get("/api/v1/users").status_code == 403
    admin = client_for("admin@example.org", ["admin"])
    r = admin.post(
        "/api/v1/users",
        json={
            "email": "new@example.org",
            "display_name": "Новый",
            "password": "0123456789ab",
            "roles": ["author"],
        },
    )
    assert r.status_code == 201 and r.json()["roles"] == ["author"]
    uid = r.json()["id"]
    r = admin.patch(f"/api/v1/users/{uid}", json={"roles": ["author", "editor"]})
    assert r.json()["roles"] == ["author", "editor"]
    me_id = admin.get("/api/v1/auth/me").json()["id"]
    assert admin.patch(f"/api/v1/users/{me_id}", json={"is_active": False}).status_code == 409
    bad = admin.post(
        "/api/v1/users",
        json={
            "email": "x@example.org",
            "display_name": "X",
            "password": "0123456789ab",
            "roles": ["superuser"],
        },
    )
    assert bad.status_code == 422


def test_internal_domain_emails_accepted(make_user):
    """Внутренние домены (.test/.local) допустимы; мусор — нет."""
    make_user("editor@lichnosti.test", ["editor"])
    api = ApiClient(TestClient(create_app()))
    assert api.login("editor@lichnosti.test").status_code == 200
    assert (
        api.c.post(
            "/api/v1/auth/login", json={"email": "not-an-email", "password": "x"}
        ).status_code
        == 422
    )
