#!/usr/bin/env bash
# Развёртывание / обновление «Личностей» на сервере (запускать на сервере от root).
#   bash /opt/lichnosti/infra/server/deploy.sh            — забрать main и пересобрать
#   BRANCH=feature bash …/deploy.sh                        — другая ветка
# Секреты лежат в /opt/lichnosti/.env.prod (chmod 600, в git не попадает).
set -euo pipefail
APP=/opt/lichnosti
REPO=${REPO:-https://github.com/bassixs/person.git}
BRANCH=${BRANCH:-main}

if [ ! -d "$APP/.git" ]; then
  git clone --branch "$BRANCH" "$REPO" "$APP"
fi
cd "$APP"
git fetch --quiet origin "$BRANCH"
git checkout --quiet "$BRANCH"
git reset --quiet --hard "origin/$BRANCH"
echo "Версия: $(git log --oneline -1)"

if [ ! -f .env.prod ]; then
  echo "Нет $APP/.env.prod — создайте его (см. docs/deployment.md)" >&2
  exit 1
fi
chmod 600 .env.prod

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build --remove-orphans
docker image prune -f >/dev/null

echo "Ждём готовности API…"
for _ in $(seq 1 30); do
  if docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api \
      python -c "import urllib.request;print(urllib.request.urlopen('http://localhost:8000/api/v1/ready').read().decode())" 2>/dev/null; then
    docker compose -f docker-compose.prod.yml --env-file .env.prod ps
    exit 0
  fi
  sleep 3
done
echo "API не поднялся — смотрите: docker compose -f docker-compose.prod.yml logs api" >&2
exit 1
