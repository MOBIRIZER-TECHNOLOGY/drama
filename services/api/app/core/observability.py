"""Structured logging, request ids and uniform error responses."""

import logging
import sys
import uuid
from collections.abc import Awaitable, Callable

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.responses import ORJSONResponse
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings


def configure_logging() -> None:
    s = get_settings()
    shared = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
    ]
    renderer = structlog.dev.ConsoleRenderer() if s.env == "local" else structlog.processors.JSONRenderer()
    structlog.configure(
        processors=[*shared, structlog.processors.StackInfoRenderer(), structlog.processors.format_exc_info, renderer],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(sys.stdout),
        cache_logger_on_first_use=True,
    )
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)


def install(app: FastAPI) -> None:
    log = structlog.get_logger()

    @app.middleware("http")
    async def request_context(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id, path=request.url.path, method=request.method)
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

    @app.exception_handler(IntegrityError)
    async def integrity(request: Request, exc: IntegrityError) -> ORJSONResponse:
        log.warning("db.integrity_error", error=str(exc.orig)[:300])
        return ORJSONResponse(
            status_code=409,
            content={"detail": {"code": "conflict", "message": "That change conflicts with existing data"}},
        )

    @app.exception_handler(ValueError)
    async def value_error(request: Request, exc: ValueError) -> ORJSONResponse:
        return ORJSONResponse(status_code=400, content={"detail": {"code": "bad_request", "message": str(exc)[:300]}})

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> ORJSONResponse:
        log.exception("http.unhandled")
        return ORJSONResponse(
            status_code=500,
            content={
                "detail": {
                    "code": "internal_error",
                    "message": "Something went wrong",
                    "request_id": structlog.contextvars.get_contextvars().get("request_id"),
                }
            },
        )
