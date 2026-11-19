# Развёртывание

Боевой сервер (E-031): VPS Ubuntu 24.04, 2 vCPU / 3,8 ГБ / 48 ГБ, Москва. Адрес системы —
**https://82-97-249-112.sslip.io** (временный, пока нет своего домена; см. «Смена домена»).

## Схема

```
интернет ──443/80──▶ Caddy (HTTPS, Let's Encrypt) ──▶ web (nginx: SPA + /api) ──▶ api (FastAPI) ──▶ postgres
```

- Наружу открыт только Caddy. API, nginx и PostgreSQL — во внутренней сети Docker.
- Фоновые задачи (проверки ИИ) идут внутри процесса API (E-029); Redis и Celery на сервере не поднимаются.
- Файлы: `docker-compose.prod.yml`, `infra/docker/{api.Dockerfile,web.Dockerfile,nginx.conf,Caddyfile}`.

## Подготовка сервера (один раз)

```bash
ssh root@SERVER 'bash -s' < infra/server/bootstrap.sh
```

Скрипт идемпотентный: удаляет nginx/MariaDB, сжимает логи (журнал ≤ 500 МБ), SSH — ключи и пароль
(`SSH_PASSWORD_LOGIN=no` — только ключи), ufw
(22, 80, 443; 10050 — только для мониторинга хостинга), fail2ban, автообновления безопасности, swap 2 ГБ, Docker.

## Секреты

`/opt/lichnosti/.env.prod` (chmod 600, в git не попадает):

```
SITE_ADDRESS=82-97-249-112.sslip.io
POSTGRES_PASSWORD=<openssl rand -hex 24>
CORS_ORIGINS=["https://82-97-249-112.sslip.io"]
LLM_BASE_URL=https://api.aitunnel.ru/v1
LLM_API_KEY=<ключ AITUNNEL>
LLM_MODEL=claude-haiku-5.5
LLM_MODEL_CHECK=gpt-6-luna-pro
LLM_MODEL_FINAL=claude-sonnet-5.5
DECISIONS_MODEL=pplx-decider-v1.2
LLM_TIMEOUT_SECONDS=120
```

`COOKIE_SECURE=true` и `APP_ENV=production` задаёт compose.

## Развёртывание и обновление

```bash
ssh root@SERVER 'bash /opt/lichnosti/infra/server/deploy.sh'
```

Забирает `main`, пересобирает образы, применяет миграции (`alembic upgrade head` при старте API) и ждёт `/ready`.

## Пользователи

Пароль вводится интерактивно — не передавайте его в командной строке:

```bash
ssh -t root@SERVER 'cd /opt/lichnosti && docker compose -f docker-compose.prod.yml --env-file .env.prod exec api python -m app.cli create-user --email you@org.ru --name "Имя" --roles editor'
```

Семь исходных легенд как черновики:

```bash
ssh root@SERVER 'cd /opt/lichnosti && docker compose -f docker-compose.prod.yml --env-file .env.prod exec api python -m app.cli seed-personas --as you@org.ru --confirm'
```

## Резервные копии

`infra/server/backup.sh` по cron каждый день в 03:30 UTC: `pg_dump` → `/var/backups/lichnosti/*.sql.gz`, хранится
14 дней. Восстановление — команда в шапке скрипта. Копии лежат на том же сервере; для защиты от потери сервера
включите бэкапы в панели хостинга или настройте выгрузку во внешнее хранилище.

## Смена домена

1. A-запись домена → IP сервера.
2. В `.env.prod`: `SITE_ADDRESS=домен`, `CORS_ORIGINS=["https://домен"]`.
3. `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d` — Caddy сам получит сертификат.

## Диагностика

```bash
cd /opt/lichnosti && docker compose -f docker-compose.prod.yml --env-file .env.prod ps
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api
```
