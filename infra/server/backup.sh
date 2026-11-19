#!/usr/bin/env bash
# Ежедневный дамп PostgreSQL «Личностей» (cron на сервере). Хранится 14 последних дней.
# Восстановление: gunzip -c FILE.sql.gz | docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres psql -U lichnosti lichnosti
set -euo pipefail
APP=/opt/lichnosti
DIR=${BACKUP_DIR:-/var/backups/lichnosti}
KEEP_DAYS=${KEEP_DAYS:-14}
mkdir -p "$DIR"
chmod 700 "$DIR"
cd "$APP"
f="$DIR/lichnosti-$(date -u +%Y%m%d-%H%M).sql.gz"
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  pg_dump -U lichnosti --no-owner lichnosti | gzip -9 > "$f.tmp"
mv "$f.tmp" "$f"
find "$DIR" -name 'lichnosti-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "$(date -u +%FT%TZ) $(du -h "$f" | cut -f1) $f"
