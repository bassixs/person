# Модель данных (миграция 0001)

| Таблица | Ключевые поля | Примечания |
|---|---|---|
| `roles` | `code`, `title` | admin, editor, author, operator (заполняются миграцией) |
| `users` | `email` (uniq), `password_hash` (Argon2), `is_active` | |
| `user_roles` | `user_id`, `role_code` | роли совмещаются |
| `user_sessions` | `token_hash` (sha256), `csrf_token`, `expires_at`, `revoked_at` | сам токен в БД не хранится |
| `audit_events` | `actor_user_id`, `action`, `entity_type`, `entity_id`, `entity_version`, `details` JSONB, `request_id` | |
| `personas` | `display_name`, `short_context`, `status`, `active_version_id`, `creation_mode`, `is_seed`, `archived_at` | CHECK на статус |
| `persona_versions` | `version_major/minor`, `state`, `schema_version`, `passport` JSONB, `content_hash`, `revision`, `based_on_version_id`, `approved_by/at` | уникальны (persona, major, minor); ≤1 draft и ≤1 active на персону; триггер неизменяемости |
| `persona_source_materials` | `kind` (`original_legend`), `content` | триггер запрета UPDATE |

## Паспорт (JSONB, schema_version = 1)

```json
{
  "schema_version": 1,
  "sections": {
    "legend": {
      "fields": {
        "occupation": {
          "value": "Фермер",
          "source_kind": "original_legend | editor | ai_suggestion",
          "certainty": "defined | hypothesis | unknown",
          "editor_approved": false,
          "dependencies": ["competence.knowledge_areas"]
        }
      },
      "narrative": "…"
    }
  }
}
```

Разделы: `legend, family, experience, character, worldview, competence, speech, behavior, limits`.
`content_hash` — sha256 канонического JSON паспорта; проверки итерации 2 будут привязаны к нему.

Остальные таблицы ТЗ §5 (`persona_change_proposals`, `persona_validation_runs`, `persona_test_runs`, `topics…`,
`tasks…`, `ai_skills…`) появятся отдельными миграциями в итерациях 2–5.
