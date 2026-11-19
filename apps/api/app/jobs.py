"""Фоновые задачи (E-029): пул потоков внутри процесса API, статус — в БД.

Долгие вызовы ИИ (проверка ~1 мин) не держат HTTP-запрос: API создаёт запись со статусом
«в очереди», задача выполняется в фоне, интерфейс опрашивает статус. Переход на Celery+Redis
меняет только этот модуль. В тестах (APP_ENV=test) задачи выполняются сразу — детерминированно.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

log = logging.getLogger("lichnosti.jobs")
_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="lichnosti-job")


def submit(fn: Callable[..., Any], *args: Any) -> None:
    def _run() -> None:
        try:
            fn(*args)
        except Exception:  # noqa: BLE001 — задача сама пишет ошибку в БД; здесь только лог
            log.exception("Фоновая задача %s завершилась с ошибкой", getattr(fn, "__name__", fn))

    if os.environ.get("APP_ENV") == "test":
        _run()
    else:
        _pool.submit(_run)
