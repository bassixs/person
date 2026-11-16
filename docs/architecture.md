# Архитектура (итерация 1)

**Сайт настраивает → ИИ предлагает/проверяет → редактор утверждает → MAX использует.** Источник истины — общий
backend и PostgreSQL.

```
Браузер (React SPA) ──/api/v1──► FastAPI ──► PostgreSQL (JSONB паспорта, триггеры неизменяемости)
                                   │
                                   ├── адаптеры: LLM (OpenAI-compatible) · веб-поиск · MAX → конфигурация/проверка
                                   └── Redis ◄── Celery worker (каркас; задачи — итерации 2–4)
```

## Слои backend (`apps/api/app`)

| Модуль | Назначение |
|---|---|
| `models.py` | ORM: users/roles/user_roles/user_sessions/audit_events, personas/persona_versions/persona_source_materials |
| `passport.py` | Схема гибридного паспорта v1 (9 разделов), валидация, `content_hash`, слияние ручной правки с контролем provenance |
| `rbac.py` | Матрица прав — единственное место, где роли превращаются в разрешения |
| `deps.py` | Текущий пользователь из cookie-сессии, CSRF для изменяющих запросов |
| `services/personas.py` | Доменные операции (создание, правка черновика с optimistic locking, новая версия, архив) |
| `activation.py` | Барьер активации; в итерации 2 — проверка прогонов validation/lab по `content_hash` |
| `integrations/` | Адаптеры LLM, поиска, MAX: статус и реальная проверка соединения, без секретов в ответах |
| `routers/` | HTTP: auth, users, personas, system (overview, integrations, audit, health/ready) |
| `cli.py`, `seed_data.py` | создание пользователей, импорт семи легенд как черновиков |

## Инварианты и где они обеспечены

| Инвариант | Где |
|---|---|
| Активная (не-draft) версия неизменяема | API (`version_immutable`) + триггер `persona_versions_guard` |
| Исходная легенда неизменяема | триггер `persona_source_materials_guard` |
| Активировать может только editor; admin/operator/author — 403 даже прямым вызовом | `rbac.py`, `routers/personas.py::activate` |
| Активация без актуальной проверки и лаборатории невозможна | `activation.py` |
| Гонки правок черновика | `expected_revision` + `SELECT … FOR UPDATE` → 409 `revision_conflict` |
| Происхождение значений не подделывается вручную | `passport.merge_editor_update` |
| ИИ без ключа не изображает работу | 503 `llm_not_configured`, статусы интеграций |
| Все изменения аудируются | `audit.record` в той же транзакции |

## Frontend (`apps/web/src`)

`router.tsx` (защищённые маршруты), `components/Layout.tsx` (фиксированная верхняя навигация, без глобального
sidebar), `components/Ambient.tsx` (живой фон), `pages/*` (Обзор, Личности, Рабочая карточка, Контекст, Задания,
Лаборатория, Настройки), `api/client.ts` (CSRF + единый формат ошибок). Формы паспорта строятся из
`GET /personas/schema` — схема не дублируется на клиенте.
