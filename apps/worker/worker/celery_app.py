"""Фоновые задачи «Личностей» (Celery + Redis).

Итерация 1: каркас и health-задача. Задачи ИИ, мониторинга избранных тем и обработки
файлов появятся в итерациях 2–4; все они будут идемпотентными (ключ = объект + content_hash).
"""

import os

from celery import Celery

app = Celery(
    "lichnosti",
    broker=os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
    backend=os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
)
app.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    timezone="UTC",
    beat_schedule={},  # расписание мониторинга — только для тем, выбранных редактором (итерация 4)
)


@app.task(name="system.ping")
def ping() -> str:
    return "pong"
