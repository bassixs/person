# Развёртывание

Хостинг, домен и production CI/CD владельцем **не выбраны** (PROJECT_CONTEXT §20). Предоставлен Docker Compose.

1. `cp .env.example .env`; задать `POSTGRES_PASSWORD`, `COOKIE_SECURE=true` (за HTTPS), `CORS_ORIGINS`.
2. `docker compose up -d --build` — api при старте применяет `alembic upgrade head`.
3. Создать первого администратора и редактора: `docker compose exec api python -m app.cli create-user …`.
4. Проверка: `GET /api/v1/ready` → `{"status":"ready","migration":"0001"}`.

Секреты (LLM / поиск / MAX) — только в окружении сервера, в браузер не передаются. TLS терминируется перед `web`
(nginx) внешним прокси. Резервное копирование тома `pgdata` — задача эксплуатации.

> Статус: compose-файл и Dockerfile'ы написаны, но в среде разработки Docker отсутствовал — сборка образов
> **не проверялась**. Приложение проверено локально на PostgreSQL 16 (pgserver), uvicorn и Vite.
