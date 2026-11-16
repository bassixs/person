"""Конфигурация приложения. Все секреты — только из окружения, никогда не уходят на frontend."""

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
    llm_model: str | None = None
    llm_timeout_seconds: float = 30.0

    # Веб-поиск (провайдер не выбран владельцем — только конфигурация)
    search_provider: str | None = None
    search_api_key: SecretStr | None = None

    # MAX
    max_bot_token: SecretStr | None = None
    max_api_base_url: str = "https://platform-api2.max.ru"

    redis_url: str = "redis://localhost:6379/0"


@lru_cache
def get_settings() -> Settings:
    return Settings()
