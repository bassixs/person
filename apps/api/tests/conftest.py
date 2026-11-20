"""Тесты работают на РЕАЛЬНОМ PostgreSQL (TEST_DATABASE_URL), не на SQLite и не на моках."""

import os
import pathlib

import pytest

TEST_DB = os.environ.get("TEST_DATABASE_URL")
if not TEST_DB:
    raise RuntimeError(
        "Задайте TEST_DATABASE_URL (отдельная БД!). Локально: python scripts/dev_postgres.py"
    )
os.environ["DATABASE_URL"] = TEST_DB
os.environ["APP_ENV"] = "test"
for k in ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "MAX_BOT_TOKEN", "SEARCH_API_KEY"):
    os.environ.pop(k, None)

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import get_engine, session_factory  # noqa: E402
from app.models import User, UserRole  # noqa: E402
from app.security import hash_password, login_limiter  # noqa: E402

API_DIR = pathlib.Path(__file__).resolve().parent.parent
PASSWORD = "correct-horse-battery"


@pytest.fixture(scope="session", autouse=True)
def _migrated():
    get_settings.cache_clear()
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "alembic"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def _clean():
    with get_engine().begin() as conn:
        conn.execute(
            text(
                "TRUNCATE audit_events, user_sessions, user_roles, users, "
                "persona_source_materials, persona_versions, personas, topic_claim_flags, "
                "topic_versions, topics, knowledge_item_topics, knowledge_chunks, knowledge_items, "
                "stored_files, "
                "source_fetches, source_registry CASCADE"
            )
        )
    login_limiter._hits.clear()
    yield


@pytest.fixture
def make_user():
    def _make(email: str, roles: list[str]) -> User:
        with session_factory()() as db:
            u = User(
                email=email, display_name=email.split("@")[0], password_hash=hash_password(PASSWORD)
            )
            u.role_links = [UserRole(role_code=r) for r in roles]
            db.add(u)
            db.commit()
            return u

    return _make


class ApiClient:
    def __init__(self, client: TestClient) -> None:
        self.c = client
        self.csrf: str | None = None

    def login(self, email: str, password: str = PASSWORD):
        r = self.c.post("/api/v1/auth/login", json={"email": email, "password": password})
        if r.status_code == 200:
            self.csrf = r.json()["csrf_token"]
        return r

    def _h(self):
        return {"X-CSRF-Token": self.csrf} if self.csrf else {}

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def post(self, url, **kw):
        return self.c.post(url, headers=self._h(), **kw)

    def put(self, url, **kw):
        return self.c.put(url, headers=self._h(), **kw)

    def patch(self, url, **kw):
        return self.c.patch(url, headers=self._h(), **kw)


@pytest.fixture
def client_for(make_user):
    from app.main import create_app

    def _client(email: str, roles: list[str]) -> ApiClient:
        make_user(email, roles)
        api = ApiClient(TestClient(create_app()))
        assert api.login(email).status_code == 200
        return api

    return _client
