FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/* \
  && pip install --no-cache-dir uv && useradd -r -u 10001 katha
WORKDIR /srv/services/worker

# The sibling services are editable path dependencies (see [tool.uv.sources]), so uv builds them from source
# at sync time and needs their package directories present. Only the packages and project files are copied:
# a whole-directory COPY used to bake local .env files, tests and virtualenvs into the image.
COPY services/api/pyproject.toml services/api/uv.lock /srv/services/api/
COPY services/api/app /srv/services/api/app
COPY services/ai/pyproject.toml services/ai/uv.lock /srv/services/ai/
COPY services/ai/katha_ai /srv/services/ai/katha_ai
COPY services/worker/pyproject.toml services/worker/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY services/worker/worker ./worker
RUN uv sync --frozen --no-dev && chown -R katha /srv
USER katha
HEALTHCHECK --interval=60s --timeout=10s CMD uv run --no-sync arq --check worker.main.WorkerSettings || exit 1
CMD ["uv", "run", "--no-sync", "arq", "worker.main.WorkerSettings"]
