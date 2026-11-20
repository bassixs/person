"""Конфигурация приложения. Все секреты — только из окружения, никогда не уходят на frontend."""

import os
from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"), extra="ignore", env_ignore_empty=True
    )

    app_env: str = Field(default="development", description="development | test | production")
    database_url: str = "postgresql+psycopg://lichnosti:lichnosti@localhost:5432/lichnosti"

    # Сессии
    session_ttl_hours: int = 12
    session_cookie_name: str = "lichnosti_session"
    csrf_cookie_name: str = "lichnosti_csrf"
    cookie_secure: bool = False  # в production обязательно true (HTTPS)

    # Ограничение попыток входа (на процесс API)
    login_max_attempts: int = 8
    login_window_seconds: int = 300

    cors_origins: list[str] = ["http://localhost:5173"]

    # LLM: OpenAI-compatible адаптер. Без ключа — честный статус «не подключено».
    llm_base_url: str | None = None
    llm_api_key: SecretStr | None = None
    llm_model: str | None = None  # интервью, предложения, углубление (E-028)
    # Модели по ролям (E-028); пусто — используется llm_model
    llm_model_check: str | None = None  # «Проверить целостность», объяснения лаборатории
    llm_model_final: str | None = None  # финальная проверка перед активацией
    # Decisions API (быстрые вероятностные ответы без текста): «светофор», судейство лаборатории
    decisions_model: str | None = None
    # Эмбеддинги для смыслового поиска (E-037): тот же провайдер, что и LLM; пусто — только
    # полнотекстовый поиск с честным статусом.
    embedding_model: str | None = None
    embedding_dimensions: int = 1024
    # Ниже этого сходства смысловое совпадение не показываем (замер: нерелевантное 0.11–0.14)
    semantic_min_similarity: float = 0.2
    llm_timeout_seconds: float = 60.0
    # response_format=json_object; выключите, если провайдер его не поддерживает
    llm_json_mode: bool = True
    # Потолок длины ответа: без него JSON может оборваться;
    # AITUNNEL резервирует оплату именно по нему.
    llm_max_tokens: int = 8000

    # Веб-поиск (провайдер не выбран владельцем — только конфигурация)
    search_provider: str | None = None
    search_api_key: SecretStr | None = None

    # MAX
    max_bot_token: SecretStr | None = None
    max_api_base_url: str = "https://platform-api2.max.ru"

    redis_url: str = "redis://localhost:6379/0"


def model_for(role: str) -> str | None:
    """Модель для роли: interview | check | final. Неуказанная роль падает на основную модель."""
    s = get_settings()
    return {"check": s.llm_model_check, "final": s.llm_model_final}.get(role) or s.llm_model


@lru_cache
def get_settings() -> Settings:
    # Тесты не должны зависеть от локального .env (там может лежать настоящий ключ LLM).
    if os.environ.get("APP_ENV") == "test":
        return Settings(_env_file=None)  # type: ignore[call-arg]
    return Settings()
