# worker

Celery-воркер (брокер Redis). В итерации 1 — только каркас и задача `system.ping`.

```bash
celery -A worker.celery_app worker --loglevel=info
```

Запускается в Docker Compose сервисом `worker` (использует образ API: общий код и модели).
