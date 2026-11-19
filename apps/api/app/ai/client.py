"""Клиент LLM для навыков: OpenAI-compatible /chat/completions, строгий JSON, повторы, трасса.

Правила (CLAUDE.md, ТЗ §6):
- провайдер задаётся конфигурацией (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL); ключ не покидает сервер;
- без настройки — честная ошибка 503 «не подключено», никаких выдуманных результатов;
- ответ модели валидируется Pydantic-схемой навыка; при ошибке — повтор с указанием проблемы;
- каждый вызов пишется в ai_runs (успех и ошибка) отдельной транзакцией — трасса не теряется при откате.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Protocol, TypeVar
from uuid import UUID

import httpx
from pydantic import BaseModel, ValidationError

from app.config import get_settings
from app.db import session_factory
from app.errors import ApiError
from app.models import AiRun

T = TypeVar("T", bound=BaseModel)


@dataclass
class Completion:
    text: str
    model: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class LlmProvider(Protocol):
    model: str

    def complete(self, messages: list[dict[str, str]]) -> Completion: ...


class OpenAICompatibleProvider:
    def __init__(self) -> None:
        s = get_settings()
        assert s.llm_base_url and s.llm_api_key and s.llm_model
        self.base_url = s.llm_base_url.rstrip("/")
        self.key = s.llm_api_key.get_secret_value()
        self.model = s.llm_model
        self.timeout = s.llm_timeout_seconds
        self.json_mode = s.llm_json_mode

    def complete(self, messages: list[dict[str, str]]) -> Completion:
        body: dict[str, Any] = {"model": self.model, "messages": messages, "temperature": 0.4}
        if self.json_mode:
            body["response_format"] = {"type": "json_object"}
        r = httpx.post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.key}"},
            json=body,
            timeout=self.timeout,
        )
        if r.status_code != 200:
            raise ApiError(502, "llm_failed", f"LLM-провайдер ответил ошибкой HTTP {r.status_code}")
        data = r.json()
        usage = data.get("usage") or {}
        return Completion(
            text=data["choices"][0]["message"]["content"] or "",
            model=data.get("model") or self.model,
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
        )


# Подмена провайдера в тестах (никогда не используется в рабочем коде).
_override: LlmProvider | None = None


def set_provider_override(provider: LlmProvider | None) -> None:
    global _override
    _override = provider


def llm_configured() -> bool:
    if _override is not None:
        return True
    s = get_settings()
    return bool(s.llm_base_url and s.llm_api_key and s.llm_model)


def get_provider() -> LlmProvider:
    if _override is not None:
        return _override
    if not llm_configured():
        raise ApiError(
            503,
            "llm_not_configured",
            "ИИ не подключён: задайте LLM-провайдера на сервере. "
            "Пока можно работать с паспортом вручную.",
        )
    return OpenAICompatibleProvider()


_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def _parse_json(text: str) -> Any:
    cleaned = _FENCE.sub("", text.strip())
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("В ответе нет JSON-объекта")
    return json.loads(cleaned[start : end + 1])


@dataclass
class SkillCall:
    skill: str
    version: str
    system: str
    user: str
    actor_id: UUID | None
    entity_type: str
    entity_id: str
    max_attempts: int = 2
    trace: dict[str, Any] = field(default_factory=dict)


def run_skill(call: SkillCall, schema: type[T]) -> tuple[T, str]:
    """Вызывает модель и возвращает (валидированный результат, имя модели)."""
    provider = get_provider()
    messages = [
        {"role": "system", "content": call.system},
        {"role": "user", "content": call.user},
    ]
    started = time.perf_counter()
    prompt_tokens = completion_tokens = 0
    last_error = ""
    attempts = 0
    model = getattr(provider, "model", None)
    for attempts in range(1, call.max_attempts + 1):
        try:
            c = provider.complete(messages)
        except httpx.HTTPError as e:
            last_error = f"Сетевая ошибка LLM: {type(e).__name__}"
            break
        except ApiError as e:
            last_error = e.message
            break
        model = c.model
        prompt_tokens += c.prompt_tokens or 0
        completion_tokens += c.completion_tokens or 0
        try:
            result = schema.model_validate(_parse_json(c.text))
        except (ValueError, ValidationError) as e:
            last_error = str(e)[:1500]
            messages += [
                {"role": "assistant", "content": c.text[:4000]},
                {
                    "role": "user",
                    "content": "Ответ не прошёл проверку схемы:\n"
                    f"{last_error}\nВерни только исправленный JSON-объект, без пояснений.",
                },
            ]
            continue
        _record(call, "ok", model, prompt_tokens, completion_tokens, started, attempts, None)
        return result, model or ""
    _record(call, "error", model, prompt_tokens, completion_tokens, started, attempts, last_error)
    raise ApiError(
        502,
        "llm_failed",
        "ИИ не смог дать корректный ответ. Попробуйте ещё раз — паспорт не изменён.",
        {"reason": last_error[:300]},
    )


def _record(
    call: SkillCall,
    status: str,
    model: str | None,
    prompt_tokens: int,
    completion_tokens: int,
    started: float,
    attempts: int,
    error: str | None,
) -> None:
    with session_factory()() as db:
        db.add(
            AiRun(
                skill=call.skill,
                skill_version=call.version,
                model=model,
                status=status,
                entity_type=call.entity_type,
                entity_id=call.entity_id,
                prompt_tokens=prompt_tokens or None,
                completion_tokens=completion_tokens or None,
                latency_ms=round((time.perf_counter() - started) * 1000),
                attempts=max(attempts, 1),
                error=error,
                created_by_id=call.actor_id,
            )
        )
        db.commit()
