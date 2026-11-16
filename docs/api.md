# API v1 (итерация 1)

OpenAPI: `/api/v1/openapi.json`, Swagger UI: `/api/v1/docs`.

Ошибки: `{"error": {"code", "message", "details", "request_id"}}`. Каждый ответ содержит `X-Request-ID`.
Изменяющие запросы требуют заголовок `X-CSRF-Token` (значение из `GET /auth/me` или cookie `lichnosti_csrf`).

| Метод и путь | Права | Описание |
|---|---|---|
| `GET /health`, `GET /ready` | — | liveness; readiness (БД + ревизия миграций) |
| `POST /auth/login` | — | вход; HttpOnly cookie сессии + CSRF-cookie; 429 при переборе |
| `POST /auth/logout`, `GET /auth/me` | сессия | выход; профиль, роли, разрешения, CSRF |
| `GET/POST /users`, `PATCH /users/{id}`, `GET /users/roles` | `users.manage` (admin) | сотрудники и роли |
| `GET /personas/schema` | сессия | схема паспорта v1 |
| `GET /personas` | read_all / read_active | `q`, `status[]`, `include_archived`, `sort`, `page`, `page_size` |
| `POST /personas` | `persona.create` | `mode`: `manual` / `legend` (нужен `legend_text`) / `ai_draft` (503 без LLM, 501 до итерации 2) |
| `GET /personas/{id}`, `PATCH /personas/{id}` | read / edit | карточка + версии + исходные материалы + `capabilities` |
| `POST /personas/{id}/archive`, `/unarchive` | `persona.archive` (editor) | архив обратим |
| `GET /personas/{id}/versions/{vid}` | read | паспорт + заполненность |
| `PUT /personas/{id}/versions/{vid}` | `persona.edit` | `{passport, expected_revision}`; 409 `revision_conflict` / `version_immutable` / `persona_archived` |
| `POST /personas/{id}/versions` | `persona.edit` | новый черновик от активной версии |
| `GET /personas/{id}/activation-check?version_id=` | read | список блокеров |
| `POST /personas/{id}/activate` | `persona.activate` (editor) | 409 `activation_blocked` с блокерами |
| `GET /personas/{id}/history` | read_all | журнал по персоне и её версиям |
| `GET /overview` | сессия | только реальные данные; модули будущих итераций — `available: false` |
| `GET /integrations/status`, `POST /integrations/{llm,max}/check` | сессия / admin | статусы и реальная проверка соединения |
| `GET /audit` | `audit.read` | `entity_id`, `action`, пагинация |
