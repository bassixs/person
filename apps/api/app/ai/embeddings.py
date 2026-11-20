"""Адаптер эмбеддингов (E-037): OpenAI-совместимый `/embeddings` того же провайдера, что и LLM.

Без модели или ключа — `embeddings_configured() == False`, поиск работает только по словам,
интерфейс честно показывает «смысловой поиск не подключён». В тестах — `set_embedder_override`.
"""

from __future__ import annotations

import math
import time
from collections.abc import Callable, Sequence

import httpx

from app.config import get_settings
from app.errors import ApiError

BATCH = 64

Embedder = Callable[[Sequence[str]], list[list[float]]]
_override: Embedder | None = None


def set_embedder_override(fn: Embedder | None) -> None:
    global _override
    _override = fn


def embeddings_configured() -> bool:
    if _override is not None:
        return True
    s = get_settings()
    return bool(s.embedding_model and s.llm_base_url and s.llm_api_key)


def model_name() -> str:
    return "test-embedder" if _override is not None else (get_settings().embedding_model or "")


def dimensions() -> int:
    return get_settings().embedding_dimensions


def _normalize(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def embed(texts: Sequence[str]) -> list[list[float]]:
    """Векторы единичной длины (косинусная близость = скалярное произведение)."""
    if not texts:
        return []
    if _override is not None:
        return [_normalize(v) for v in _override(texts)]
    s = get_settings()
    if not embeddings_configured():
        raise ApiError(503, "embeddings_not_configured", "Смысловой поиск не подключён")
    assert s.llm_base_url and s.llm_api_key
    out: list[list[float]] = []
    with httpx.Client(timeout=s.llm_timeout_seconds) as client:
        for i in range(0, len(texts), BATCH):
            chunk = [t[:8000] for t in texts[i : i + BATCH]]
            for attempt in range(3):
                r = client.post(
                    f"{s.llm_base_url.rstrip('/')}/embeddings",
                    headers={"Authorization": f"Bearer {s.llm_api_key.get_secret_value()}"},
                    json={
                        "model": s.embedding_model,
                        "input": chunk,
                        "dimensions": s.embedding_dimensions,
                    },
                )
                if r.status_code == 200:
                    break
                if r.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                raise ApiError(
                    502, "embeddings_failed", f"Провайдер эмбеддингов ответил {r.status_code}"
                )
            data = sorted(r.json()["data"], key=lambda d: d["index"])
            vecs = [d["embedding"] for d in data]
            if any(len(v) != s.embedding_dimensions for v in vecs):
                raise ApiError(502, "embeddings_failed", "Размер вектора не совпадает с настройкой")
            out += [_normalize(v) for v in vecs]
    return out
