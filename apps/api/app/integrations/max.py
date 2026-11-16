"""MAX Bot API адаптер (итерация 1: статус и проверка соединения).

Документация: https://dev.max.ru/docs-api — домен platform-api2.max.ru, заголовок Authorization.
Метод проверки (GET /me) нужно сверить с актуальной документацией при реализации итерации 5.
"""

import time
from typing import Any

import httpx

from app.config import get_settings


def max_status() -> dict[str, Any]:
    s = get_settings()
    return {
        "name": "max",
        "title": "MAX-бот",
        "status": "configured" if s.max_bot_token else "not_configured",
        "verified": False,
        "detail": {"api": s.max_api_base_url},
        "how_to_connect": "Задайте MAX_BOT_TOKEN в .env (сервер). Сценарии бота — итерация 5.",
    }


def max_check() -> dict[str, Any]:
    s = get_settings()
    st = max_status()
    if not s.max_bot_token:
        return {**st, "ok": False, "error": "Токен не задан"}
    started = time.perf_counter()
    try:
        r = httpx.get(
            s.max_api_base_url.rstrip("/") + "/me",
            headers={"Authorization": s.max_bot_token.get_secret_value()},
            timeout=15,
        )
        ok = r.status_code == 200
        return {
            **st,
            "verified": ok,
            "ok": ok,
            "latency_ms": round((time.perf_counter() - started) * 1000),
            "error": None if ok else f"HTTP {r.status_code}",
        }
    except httpx.HTTPError as e:
        return {**st, "ok": False, "error": type(e).__name__}
