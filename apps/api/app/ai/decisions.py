"""Decisions API AITUNNEL (`POST {base}/decisions`): вероятностные ответы на заданные вопросы.

Модель не пишет текст, а оценивает «да/нет», выбор или шкалу. Дёшево и быстро (E-028), но без
объяснений — поэтому используется только как подсказка («светофор», судейство), а решения,
блокирующие активацию, опираются на полный отчёт LLM.
"""

from __future__ import annotations

import time
from typing import Any, Protocol
from uuid import UUID

import httpx

from app.config import get_settings
from app.db import session_factory
from app.models import AiRun


class DecisionsUnavailable(Exception):
    """Decisions не настроен или провайдер ответил ошибкой — подсказки просто нет."""


class DecisionsProvider(Protocol):
    model: str

    def decide(
        self, state: Any, questions: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Возвращает (answers, usage)."""
        ...


class AitunnelDecisions:
    def __init__(self) -> None:
        s = get_settings()
        assert s.llm_base_url and s.llm_api_key and s.decisions_model
        self.url = s.llm_base_url.rstrip("/") + "/decisions"
        self.key = s.llm_api_key.get_secret_value()
        self.model = s.decisions_model

    def decide(
        self, state: Any, questions: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        r = httpx.post(
            self.url,
            headers={"Authorization": f"Bearer {self.key}"},
            json={"model": self.model, "state": state, "questions": questions},
            timeout=30,
        )
        if r.status_code != 200:
            raise DecisionsUnavailable(f"HTTP {r.status_code}")
        d = r.json()
        return d.get("answers") or {}, d.get("usage") or {}


_override: DecisionsProvider | None = None


def set_decisions_override(provider: DecisionsProvider | None) -> None:
    global _override
    _override = provider


def decisions_configured() -> bool:
    if _override is not None:
        return True
    s = get_settings()
    return bool(s.llm_base_url and s.llm_api_key and s.decisions_model)


def decide(
    skill: str,
    state: Any,
    questions: dict[str, Any],
    *,
    actor_id: UUID | None,
    entity_type: str,
    entity_id: str,
) -> tuple[dict[str, Any], str]:
    if not decisions_configured():
        raise DecisionsUnavailable("Decisions не настроен")
    provider: DecisionsProvider = _override or AitunnelDecisions()
    started = time.perf_counter()
    error: str | None = None
    usage: dict[str, Any] = {}
    try:
        answers, usage = provider.decide(state, questions)
        return answers, provider.model
    except (httpx.HTTPError, DecisionsUnavailable) as e:
        error = str(e) or type(e).__name__
        raise DecisionsUnavailable(error) from e
    finally:
        with session_factory()() as db:
            db.add(
                AiRun(
                    skill=skill,
                    skill_version="1.0",
                    model=provider.model,
                    status="error" if error else "ok",
                    entity_type=entity_type,
                    entity_id=entity_id,
                    prompt_tokens=usage.get("input_tokens"),
                    completion_tokens=usage.get("output_tokens"),
                    latency_ms=round((time.perf_counter() - started) * 1000),
                    attempts=1,
                    error=error,
                    created_by_id=actor_id,
                    cost_rub=usage.get("cost_rub"),
                )
            )
            db.commit()
