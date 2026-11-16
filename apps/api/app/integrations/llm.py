"""OpenAI-compatible LLM-адаптер.

Поставщик не выбран владельцем (PROJECT_CONTEXT §20) — поэтому только конфигурация
base_url/model/key. Без ключа статус честно «не подключено». Ключ никогда не покидает сервер.
"""

import time
from typing import Any
from urllib.parse import urlparse

import httpx

from app.config import get_settings


def llm_status() -> dict[str, Any]:
    s = get_settings()
    configured = bool(s.llm_base_url and s.llm_api_key and s.llm_model)
    return {
        "name": "llm",
        "title": "LLM-провайдер",
        "status": "configured" if configured else "not_configured",
        "verified": False,
        "detail": {
            "host": urlparse(s.llm_base_url).hostname if s.llm_base_url else None,
            "model": s.llm_model,
        },
        "how_to_connect": "Задайте LLM_BASE_URL, LLM_API_KEY и LLM_MODEL в .env (сервер).",
    }


def llm_check() -> dict[str, Any]:
    """Реальный вызов GET {base_url}/models. Возвращает результат без секретов."""
    s = get_settings()
    st = llm_status()
    if st["status"] != "configured":
        return {**st, "ok": False, "error": "Провайдер не настроен"}
    assert s.llm_api_key is not None and s.llm_base_url is not None
    started = time.perf_counter()
    try:
        r = httpx.get(
            s.llm_base_url.rstrip("/") + "/models",
            headers={"Authorization": f"Bearer {s.llm_api_key.get_secret_value()}"},
            timeout=s.llm_timeout_seconds,
        )
        latency = round((time.perf_counter() - started) * 1000)
        ok = r.status_code == 200
        return {
            **st,
            "verified": ok,
            "ok": ok,
            "latency_ms": latency,
            "error": None if ok else f"HTTP {r.status_code}",
        }
    except httpx.HTTPError as e:
        return {**st, "ok": False, "error": type(e).__name__}
