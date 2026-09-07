"""Optional tracing and error reporting. Both are no-ops until their destination is configured."""

import structlog

from app.core.config import get_settings

log = structlog.get_logger()


def init(service_name: str, app=None, engine=None) -> None:
    s = get_settings()
    if s.sentry_dsn:
        import sentry_sdk

        sentry_sdk.init(
            dsn=s.sentry_dsn,
            environment=s.env,
            release=f"katha-{service_name}@{s.api_version}",
            traces_sample_rate=s.sentry_traces_sample_rate,
            send_default_pii=False,
        )
        log.info("telemetry.sentry_enabled", service=service_name)
    if s.otlp_endpoint:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        provider = TracerProvider(
            resource=Resource.create({"service.name": f"katha-{service_name}", "deployment.environment": s.env})
        )
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=s.otlp_endpoint)))
        trace.set_tracer_provider(provider)
        if app is not None:
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

            FastAPIInstrumentor.instrument_app(app)
        if engine is not None:
            from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

            SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine)
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        HTTPXClientInstrumentor().instrument()
        log.info("telemetry.otlp_enabled", service=service_name, endpoint=s.otlp_endpoint)
