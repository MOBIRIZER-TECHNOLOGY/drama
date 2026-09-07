#!/usr/bin/env bash
# Bring up local infrastructure, apply migrations, seed, and run the database-backed tests.
#
#   pnpm db:bootstrap            everything below, in order
#   pnpm db:bootstrap -- --test  skip the seed and only run the tests
#
# Requires Docker to be running. On Windows that means Docker Desktop is started and its engine
# is ready (Virtual Machine Platform and WSL must be enabled, which needs a reboot after install).
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="$ROOT/infra/docker/compose.yaml"
API="$ROOT/services/api"
DB_URL="postgresql+asyncpg://katha:katha@localhost:5432/katha"
TEST_DB="katha_test"
TEST_URL="postgresql+asyncpg://katha:katha@localhost:5432/${TEST_DB}"
ADMIN_EMAIL="${KATHA_SEED_ADMIN_EMAIL:-admin@katha.local}"
ADMIN_PASSWORD="${KATHA_SEED_ADMIN_PASSWORD:-katha-local-admin}"

# Docker Desktop does not always put its CLI on PATH for non-login shells.
export PATH="$PATH:/c/Program Files/Docker/Docker/resources/bin"
# uv is installed as a Python module here, so call it that way.
UV="python -m uv"

say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mx %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker is not on PATH. Install Docker Desktop and reopen the shell."
docker info >/dev/null 2>&1 || die "The Docker engine is not running. Start Docker Desktop and wait for it to say Running."

say "Starting Postgres, Redis, MinIO, Mailpit and the media edge"
docker compose -f "$COMPOSE" up -d

say "Waiting for Postgres"
for i in $(seq 1 60); do
  if docker compose -f "$COMPOSE" exec -T postgres pg_isready -U katha >/dev/null 2>&1; then
    echo "ready after ${i}s"
    break
  fi
  [ "$i" -eq 60 ] && die "Postgres did not become ready within 60s"
  sleep 1
done

say "Ensuring the ${TEST_DB} database exists"
docker compose -f "$COMPOSE" exec -T postgres \
  psql -U katha -d katha -tAc "SELECT 1 FROM pg_database WHERE datname='${TEST_DB}'" | grep -q 1 \
  || docker compose -f "$COMPOSE" exec -T postgres createdb -U katha "${TEST_DB}"

cd "$API"

say "Applying migrations to katha"
KATHA_DATABASE_URL="$DB_URL" $UV run alembic upgrade head

say "Applying migrations to ${TEST_DB}"
KATHA_DATABASE_URL="$TEST_URL" $UV run alembic upgrade head

say "Checking the migrations match the models"
KATHA_DATABASE_URL="$DB_URL" $UV run alembic check

if [ "${1:-}" != "--test" ]; then
  say "Seeding katha (admin: ${ADMIN_EMAIL})"
  KATHA_DATABASE_URL="$DB_URL" $UV run python scripts/seed.py \
    --admin-email "$ADMIN_EMAIL" --admin-password "$ADMIN_PASSWORD"
fi

say "Running the full test suite, including the database-backed tests"
KATHA_DATABASE_URL="$DB_URL" KATHA_TEST_DATABASE_URL="$TEST_URL" $UV run pytest -q

say "Done"
cat <<EOF

  API        cd services/api && python -m uv run uvicorn app.main:app --reload --port 8000
  Worker     cd services/worker && python -m uv run arq worker.main.WorkerSettings
  Web        pnpm --filter web dev            http://localhost:3000
  Admin      pnpm --filter admin dev          http://localhost:3001
  Mailpit    http://localhost:8025
  MinIO      http://localhost:9001            katha / katha-secret
  Admin sign-in: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}

EOF
