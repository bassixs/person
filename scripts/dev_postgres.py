"""Локальный PostgreSQL без Docker (для разработки на машинах без Docker).

Использует pip-пакет `pgserver` (встроенные бинарники PostgreSQL 16). Создаёт базы
`lichnosti` и `lichnosti_test` и печатает DATABASE_URL. Основной путь запуска —
docker compose (см. README); этот скрипт — инженерный fallback (DECISIONS E-002).

Запуск:  apps/api/.venv/Scripts/python scripts/dev_postgres.py
"""

import pathlib

import pgserver

DATA = pathlib.Path(__file__).resolve().parent.parent / ".data" / "pg"


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    srv = pgserver.get_server(str(DATA), cleanup_mode=None)
    for name in ("lichnosti", "lichnosti_test"):
        exists = srv.psql(f"SELECT 1 FROM pg_database WHERE datname = '{name}';")
        if "(1 row)" not in exists:
            srv.psql(f"CREATE DATABASE {name};")
    base = srv.get_uri().rsplit("/", 1)[0].replace("postgresql://", "postgresql+psycopg://")
    print(f"DATABASE_URL={base}/lichnosti")
    print(f"TEST_DATABASE_URL={base}/lichnosti_test")


if __name__ == "__main__":
    main()
