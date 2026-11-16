"""Адаптер веб-поиска. Провайдер не выбран владельцем — только конфигурация и честный статус."""

from typing import Any

from app.config import get_settings


def search_status() -> dict[str, Any]:
    s = get_settings()
    configured = bool(s.search_provider and s.search_api_key)
    return {
        "name": "search",
        "title": "Веб-поиск",
        "status": "configured" if configured else "not_configured",
        "verified": False,
        "detail": {"provider": s.search_provider},
        "how_to_connect": "Поставщик поиска не выбран. Задайте SEARCH_PROVIDER и SEARCH_API_KEY; "
        "адаптер появится в итерации 4. Без провайдера дополнительный поиск недоступен.",
    }
