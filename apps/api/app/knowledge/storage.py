"""Адаптер хранения исходных файлов (ТЗ §6: локально для разработки, S3-совместимое — позже).

Сейчас — хранение в PostgreSQL (E-035): файлы до 20 МБ, попадают в ежедневный бэкап, не нужен
отдельный том. Замена на S3 — новая реализация тех же двух функций.
"""

import hashlib
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import StoredFile

MAX_FILE_BYTES = 20 * 1024 * 1024


def put(db: Session, data: bytes, mime: str) -> StoredFile:
    f = StoredFile(
        sha256=hashlib.sha256(data).hexdigest(), size_bytes=len(data), mime=mime, data=data
    )
    db.add(f)
    db.flush()
    return f


def get(db: Session, file_id: UUID) -> StoredFile | None:
    return db.get(StoredFile, file_id)
