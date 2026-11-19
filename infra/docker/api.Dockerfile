FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY apps/api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY apps/api /app
COPY apps/worker/worker /app/worker
RUN useradd --create-home appuser
USER appuser
EXPOSE 8000
# API доступен только из внутренней сети Docker (за nginx и Caddy), поэтому доверяем X-Forwarded-For —
# иначе ограничение попыток входа считалось бы общим для всех посетителей.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips '*'"]
