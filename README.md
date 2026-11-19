# «Личности»

Внутренняя платформа: версионируемые **вымышленные аналитические персоны**, Контекстный центр (темы, знания,
источники, мониторинг), ИИ-навыки и рабочий MAX-бот на общем backend.

> Персоны — внутренние модели для поиска вопросов и различий восприятия. Не реальные люди, не аккаунты
> соцсетей, не источник фактов. Публичные ответы — только с прозрачным авторством.

Продуктовый контекст: [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md) · ТЗ: [`LICHNOSTI_Claude_Code_TZ.md`](LICHNOSTI_Claude_Code_TZ.md) ·
решения реализации: [`docs/DECISIONS.md`](docs/DECISIONS.md) · правила разработки: [`CLAUDE.md`](CLAUDE.md).

**Рабочая система:** https://82-97-249-112.sslip.io — боевой сервер с HTTPS, PostgreSQL и ИИ (см. `docs/deployment.md`, E-031).

**Демо-версия (только интерфейс):** https://bassixs.github.io/person/ — данные хранятся лишь в вашем браузере,
сервера и общей базы нет. Это витрина интерфейса, а не рабочая система (см. `docs/DECISIONS.md`, E-017).

**Отчёт о проекте для руководства:** https://bassixs.github.io/person/about — персонажи (веер карточек и экран
персонажа на реальных данных легенд), как работает система, итоги этапа 1, план и что нужно для запуска (E-020).

## Состояние: итерация 1 (фундамент)

| Что | Статус |
|---|---|
| Монорепо, миграции Alembic, PostgreSQL + JSONB | ✅ работает, проверено на PostgreSQL 16 |
| Вход (Argon2, HttpOnly cookie-сессии, CSRF, rate limit), роли admin/editor/author/operator, RBAC на backend | ✅ + тесты |
| Аудит действий (create/edit/archive/activate-попытки/вход) | ✅ |
| Каталог личностей: поиск, фильтры, сортировка, карточки/таблица, архив, создание вручную и из легенды | ✅ |
| Рабочая карточка: 3 колонки, 9 разделов гибридного паспорта (value + source_kind + certainty + подтверждение + связи + нарратив), сохранение с optimistic locking, content_hash, журнал | ✅ |
| Неизменяемость активной версии и исходной легенды — триггеры БД + API | ✅ + тесты |
| Барьер активации на сервере | ✅ блокирует (проверки/лаборатория — итерация 2) |
| Seed семи легенд **только как черновики** | ✅ `scripts/seed_personas.py --confirm` |
| Дизайн-система (светлая «бумага», как в отчёте `/about`, E-021), верхняя навигация, портреты персонажей, reduced motion | ✅ |
| Docker Compose (web/api/postgres/redis/worker), CI | ⚠️ написаны, **локально не запускались** (на машине разработки нет Docker) |
| LLM / веб-поиск / MAX | 🔌 адаптеры конфигурации и проверки соединения; без ключей — честно «не подключено» |
| **Итерация 2 (в работе):** ИИ-интервью раундами по 3–5 вопросов, очередь предложений «было / станет» (принять / изменить / отклонить), «Предложить углубление», устаревание предложений, трасса вызовов ИИ (`ai_runs`) | ✅ backend + UI + тесты; с реальной моделью — после подключения LLM-ключа |
| **Проверка целостности** (Luna Pro по кнопке, финальная Sonnet для активации), «светофор» Decisions, исправления → предложения, барьер активации по `content_hash` | ✅ backend + UI + тесты; проверено с настоящими моделями AITUNNEL |
| Лаборатория (6 групп), согласование, активация v1.0 → v1.1 | ⏳ итерация 2, следующие шаги |
| Темы, мониторинг, задания, MAX-сценарии | ⏳ итерации 3–5 |

## Быстрый старт — Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

Web: http://localhost:8080 · API: http://localhost:8000/api/v1/docs · health: `/api/v1/health`, ready: `/api/v1/ready`.

Создать первого пользователя (пароль спросит интерактивно):

```bash
docker compose exec api python -m app.cli create-user --email editor@example.org --name "Редактор" --roles editor
```

Импортировать семь исходных легенд как черновики (не активируются):

```bash
docker compose exec api python -m app.cli seed-personas --as editor@example.org --confirm
```

## Локальная разработка без Docker (Windows/macOS/Linux)

Требуется Python 3.12 и Node 22.

```bash
cd apps/api
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt pgserver   # Linux/macOS: .venv/bin/pip
```

Встроенный PostgreSQL 16 (пакет `pgserver`) — создаёт базы `lichnosti` и `lichnosti_test`, печатает URL:

```bash
apps/api/.venv/Scripts/python scripts/dev_postgres.py
```

Запишите `DATABASE_URL=…/lichnosti` в корневой `.env`, затем:

```bash
cd apps/api && .venv/Scripts/alembic upgrade head
```

```bash
cd apps/api && .venv/Scripts/python -m app.cli create-user --email editor@lichnosti.test --name "Редактор" --roles editor
```

```bash
apps/api/.venv/Scripts/python -m uvicorn app.main:app --app-dir apps/api --port 8000
```

```bash
cd apps/web && npm install && npm run dev
```

Откройте http://localhost:5173 (Vite проксирует `/api` на :8000).

## Проверки

```bash
cd apps/api && TEST_DATABASE_URL=postgresql+psycopg://…/lichnosti_test .venv/Scripts/python -m pytest
```

```bash
cd apps/api && .venv/Scripts/ruff check . && .venv/Scripts/mypy app && .venv/Scripts/alembic check
```

```bash
cd apps/web && npm run lint && npm run typecheck && npm test && npm run build
```

E2E (нужен запущенный стек и учётка редактора; `PW_CHANNEL=msedge|chrome` — установленный браузер):

```bash
cd apps/web && E2E_EMAIL=… E2E_PASSWORD=… PW_CHANNEL=msedge npx playwright test
```

## Структура

```
apps/api       FastAPI + SQLAlchemy + Alembic (доменная логика, RBAC, адаптеры LLM/поиска/MAX)
apps/web       React + Vite + TypeScript + Tailwind + TanStack Query
apps/worker    Celery-воркер (каркас)
apps/max-bot   описание MAX-интеграции (итерация 5)
infra/docker   Dockerfile'ы и nginx
scripts        dev_postgres.py, seed_personas.py
docs           контекст, решения, архитектура, API, модель данных, UI/UX, деплой
```
