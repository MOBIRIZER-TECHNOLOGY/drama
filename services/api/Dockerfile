FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1
RUN pip install --no-cache-dir uv && useradd -r -u 10001 katha
WORKDIR /srv/services/api

# Dependencies first (cacheable), project last.
COPY services/api/pyproject.toml services/api/uv.lock ./
COPY services/ai /srv/services/ai
RUN uv sync --frozen --no-dev --extra ai --no-install-project
COPY services/api/app ./app
COPY services/api/alembic ./alembic
COPY services/api/alembic.ini services/api/scripts ./
RUN uv sync --frozen --no-dev --extra ai && chown -R katha /srv

USER katha
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/ready')" || exit 1
CMD ["uv", "run", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
