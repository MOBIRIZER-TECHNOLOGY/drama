from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api.routers import (
    admin_ads,
    admin_ai,
    admin_auth,
    admin_catalog,
    admin_dashboard,
    admin_growth,
    admin_monetization,
    admin_ops,
    admin_users,
    ads,
    auth,
    catalog,
    config,
    content,
    engagement,
    events,
    health,
    media,
    purchases,
    rewards,
    stream,
    uploads,
    wallet,
)
from app.core import observability, telemetry
from app.core.config import get_settings
from app.core.db import engine
from app.core.ratelimit import limiter
from app.services import jobs

observability.configure_logging()
log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    log.info("api.start", env=s.env)
    try:  # warm the AI package so the first semantic search does not pay the import cost
        import katha_ai.embeddings  # noqa: F401
    except ImportError:
        log.info("api.ai_package_absent")
    yield
    await jobs.close()
    await engine.dispose()
    log.info("api.stop")


def _rate_limited(request, exc: RateLimitExceeded) -> ORJSONResponse:
    return ORJSONResponse(
        status_code=429,
        content={"detail": {"code": "rate_limited", "message": f"Too many requests: {exc.detail}"}},
        headers={"Retry-After": "60"},
    )


def create_app() -> FastAPI:
    s = get_settings()
    public_docs = s.env in ("local", "test", "staging")
    app = FastAPI(
        title=s.app_name,
        version=s.api_version,
        lifespan=lifespan,
        default_response_class=ORJSONResponse,
        openapi_url="/openapi.json" if public_docs else None,
        docs_url="/docs" if public_docs else None,
        redoc_url=None,
    )
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limited)
    # Added first so it ends up innermost of the three: `add_middleware` makes the most recently added the
    # outermost, and an unhandled error has to become a response *below* CORS for the browser to be told what
    # actually went wrong rather than that a header was missing.
    observability.install_error_boundary(app)
    app.add_middleware(SlowAPIMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )
    observability.install(app)
    api = "/v1"
    app.include_router(health.router)
    for r in (
        auth.router,
        config.router,
        catalog.router,
        engagement.router,
        wallet.router,
        rewards.router,
        purchases.router,
        content.router,
        admin_auth.router,
        admin_dashboard.router,
        admin_catalog.router,
        admin_monetization.router,
        admin_users.router,
        admin_ops.router,
        admin_ai.router,
        admin_ads.router,
        admin_growth.router,
        uploads.router,
        events.router,
        media.router,
        ads.router,
        stream.router,
    ):
        app.include_router(r, prefix=api)
    telemetry.init("api", app=app, engine=engine)
    return app


app = create_app()
