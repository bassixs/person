import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.errors import install_error_handlers
from app.routers import auth, lab, persona_ai, personas, system, users, validation

logger = logging.getLogger("lichnosti.api")


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    app = FastAPI(
        title="Личности API",
        version="0.1.0",
        description="Внутренняя платформа аналитических персон. Итерация 1.",
        openapi_url="/api/v1/openapi.json",
        docs_url="/api/v1/docs",
    )
    install_error_handlers(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_id_mw(request: Request, call_next):
        rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        request.state.request_id = rid
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        # Без тел запросов и персональных данных в логах.
        logger.info(
            "%s %s -> %s %.0fms rid=%s",
            request.method,
            request.url.path,
            response.status_code,
            (time.perf_counter() - started) * 1000,
            rid,
        )
        return response

    app.include_router(system.health_router, prefix="/api/v1")
    for r in (
        auth.router,
        users.router,
        personas.router,
        persona_ai.router,
        validation.router,
        lab.router,
        system.router,
    ):
        app.include_router(r, prefix="/api/v1")
    return app


app = create_app()
