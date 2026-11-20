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
| `POST /personas` | `persona.create` | `mode`: `manual` / `legend` (нужен `legend_text`) / `ai_draft` (503 без LLM, 501 — черновик целиком не генерируется) |
| `GET /personas/{id}`, `PATCH /personas/{id}` | read / edit | карточка + версии + исходные материалы + `capabilities` + `pending_proposals` + `ai_configured` |
| `POST /personas/{id}/archive`, `/unarchive` | `persona.archive` (editor) | архив обратим |
| `GET /personas/{id}/versions/{vid}` | read | паспорт + заполненность |
| `PUT /personas/{id}/versions/{vid}` | `persona.edit` | `{passport, expected_revision}`; 409 `revision_conflict` / `version_immutable` / `persona_archived` |
| `POST /personas/{id}/versions` | `persona.edit` | новый черновик от активной версии |
| `GET /personas/{id}/activation-check?version_id=` | read | список блокеров |
| `POST /personas/{id}/activate` | `persona.activate` (editor) | черновик → активная; 409 `activation_blocked` с блокерами (`validation_missing/critical`, `lab_missing/critical`, …) |
| `GET /personas/{id}/history` | read_all | журнал по персоне и её версиям |
| `GET /personas/{id}/interviews`, `GET …/interviews/{sid}` | read_all | ИИ-интервью с вопросами и ответами |
| `POST /personas/{id}/interviews` | `persona.edit` | начать (или продолжить) интервью по черновику: 1-й раунд 3–5 вопросов; 503 `llm_not_configured`, 502 `llm_failed` |
| `POST /personas/{id}/interviews/{sid}/rounds` | `persona.edit` | `{answers: [{question_id, kind: answered/unknown/skipped, text}], finish}` → предложения + следующий раунд; 422 `answers_incomplete` |
| `POST /personas/{id}/interviews/{sid}/complete` | `persona.edit` | досрочно завершить: неотвеченные — «пропущен» |
| `GET /personas/{id}/proposals?status=pending\|accepted\|rejected\|stale\|all` | read_all | очередь предложений ИИ |
| `POST /personas/{id}/proposals/deepen` | `persona.edit` | `{section}` — ИИ предлагает углубление раздела (паспорт не меняется) |
| `POST /personas/{id}/proposals/{pid}/accept` | `persona.edit` | `{expected_revision, value?, certainty?, note?}` — принять как есть или с правкой; 409 `revision_conflict` / `proposal_stale` |
| `POST /personas/{id}/proposals/{pid}/reject` | `persona.edit` | `{note?}` — отклонить (в т.ч. устаревшее) |
| `GET /personas/{id}/validations`, `GET …/validations/{rid}` | read_all | проверки целостности с замечаниями; `is_current` — относится ли к текущему `content_hash` |
| `POST /personas/{id}/validations` | `persona.edit` | `{kind: check\|final}` → 202, проверка идёт в фоне; 503 без LLM |
| `POST /personas/{id}/validations/{rid}/issues/{iid}/propose` | `persona.edit` | исправление из замечания → предложение в очереди |
| `GET /personas/{id}/consistency` | read_all | «светофор» для текущего черновика: `ready` (green/yellow/red), `pending`, `unavailable` |
| `GET /personas/{id}/lab` | read_all | набор тестов (6 групп), прогоны, `baseline` — прогон активной версии для сравнения |
| `POST /personas/{id}/lab/runs`, `GET …/lab/runs/{rid}` | `persona.edit` / read_all | прогон лаборатории (202, в фоне); вердикты pass/warning/critical с объяснениями |
| `POST /personas/{id}/submit` | `persona.edit` | `{version_id}` → на согласование; 409 `validation_required` / `validation_critical` |
| `POST /personas/{id}/versions/{vid}/suspend` | `persona.activate` (editor) | `{reason}` — экстренная приостановка активной версии |
| `GET /topics` | `topic.read_*` | каталог тем: `q`, `status`, `category`, `geography`; оператор видит только темы с активной версией |
| `POST /topics`, `PATCH /topics/{id}` | `topic.create` / `topic.edit` | создать (черновик досье v1.0), изменить название, географию, категорию |
| `GET /topics/{id}`, `GET …/versions/{vid}` | `topic.read_*` | досье, утверждения и их фактический статус (`claims_effective`: пометка и истёкший срок учитываются) |
| `PUT /topics/{id}/versions/{vid}` | `topic.edit` | `{dossier, expected_revision}` → правка черновика; `verified`/`refuted` ставит только редактор, `verified` — только с источником (422 `claim_source_required`) |
| `POST /topics/{id}/versions` | `topic.edit` | новый черновик от активной версии |
| `POST /topics/{id}/submit`, `GET …/activation-check`, `POST …/activate` | `topic.edit` / read / `topic.approve` | согласование и утверждение темы; 409 `activation_blocked` |
| `POST /topics/{id}/versions/{vid}/suspend` | `topic.approve` | `{reason}` — приостановка темы |
| `POST /topics/{id}/claim-flags` | `topic.approve` | `{claim_id, flag: refuted\|disputed\|stale\|cleared, reason}` — срочная пометка утверждения активной версии |
| `GET /topics/{id}/claims/{cid}/history`, `GET /topics/{id}/history` | read | история утверждения по версиям и пометкам; журнал темы |
| `GET /knowledge`, `GET /knowledge/{id}` | `knowledge.read` (editor, author, admin) | материалы с фильтрами `layer`, `topic_id`, `source_id`, `status`; карточка — с извлечённым текстом |
| `GET /knowledge/search?q=` | `knowledge.read` | полнотекстовый поиск (русская морфология), каждый результат — материал, источник и цитата `excerpt` с разметкой ⟦…⟧ |
| `POST /knowledge/files` | `knowledge.add` | multipart `file`, `title`, `layer`, `topic_ids`, `source_id`, `published_at`; до 20 МБ; формат по содержимому (415), дубликат (409) |
| `POST /knowledge/urls` | `knowledge.add` | `{url, …}` — получение с защитой от SSRF: 422 `url_blocked`, 502 `fetch_failed` |
| `POST /knowledge/texts` | `knowledge.add` | `{title, text, …}` |
| `PATCH /knowledge/{id}`, `POST …/archive`, `…/unarchive` | автор своего / `knowledge.manage` | метаданные, слой, темы; архив |
| `GET /knowledge/{id}/file` | `knowledge.read` | исходный файл, только как вложение (`application/octet-stream`, `nosniff`) |
| `GET /sources`, `GET /sources/{id}`, `GET …/fetches` | `source.read` | реестр и журнал обращений |
| `POST /sources`, `PATCH /sources/{id}` | `source.manage` (editor) | создать, изменить, отключить (`status`) |
| `POST /sources/{id}/check` | `source.manage` | реальная проверка соединения; ошибка записывается как ошибка получения |
| `GET /topics/{id}/understanding` | `topic.read_all` | доступность ИИ, число материалов темы, последняя карточка понимания (`is_current` — по досье и набору материалов) |
| `POST /topics/{id}/understanding`, `GET …/understanding/{rid}` | `topic.edit` / read | разбор темы ИИ в фоне (202); 503 без LLM; цитаты сверены с материалами (`quote_found`) |
| `POST /topics/{id}/understanding/{rid}/apply` | `topic.edit` | `{kind: fact\|unverified\|conflict\|question\|gap, index}` — перенести пункт в черновик; утверждение — «не проверено», происхождение «предложение ИИ»; 409 `already_applied` |
| `GET /overview` | сессия | только реальные данные; модули будущих итераций — `available: false` |
| `GET /integrations/status`, `POST /integrations/{llm,max}/check` | сессия / admin | статусы и реальная проверка соединения |
| `GET /audit` | `audit.read` | `entity_id`, `action`, пагинация |
