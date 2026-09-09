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


def _error_body(message: str = "Something went wrong") -> dict:
    return {
        "detail": {
            "code": "internal_error",
            "message": message,
            "request_id": structlog.contextvars.get_contextvars().get("request_id"),
        }
    }


def install_error_boundary(app: FastAPI) -> None:
    """Turn an unhandled exception into a response *inside* the middleware stack.

    Starlette answers exceptions in `ServerErrorMiddleware`, which wraps everything else — including CORS. So
    an unhandled 500 goes back to the browser with no `Access-Control-Allow-Origin`, and the browser reports
    it as a CORS error: no status, no body, and a message naming a header rather than the server error that
    actually happened. Every 500 then looks to a front-end engineer like a misconfigured API, and the real
    fault is invisible from the client.

    Catching one layer in means the JSON error travels back out through CORS like any other response, so the
    client sees `500 internal_error` and a request id it can quote.

    Must be added *before* the CORS middleware: `add_middleware` puts the most recently added outermost, so
    "added earlier" is what puts this inside it.
    """
    log = structlog.get_logger()

    @app.middleware("http")
    async def error_boundary(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        try:
            return await call_next(request)
        except Exception:  # noqa: BLE001 - the boundary: everything below becomes a 500 with CORS headers
            log.exception("http.unhandled")
            return ORJSONResponse(status_code=500, content=_error_body())


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

    # Backstop. `install_error_boundary` handles anything raised by a route, so what reaches here was raised
    # by a middleware outside the boundary; that response cannot pick up CORS headers, and there is nowhere
    # left to add them.
    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> ORJSONResponse:
        log.exception("http.unhandled")
        return ORJSONResponse(status_code=500, content=_error_body())
