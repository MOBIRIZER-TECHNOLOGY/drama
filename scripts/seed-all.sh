#!/usr/bin/env bash
# One command from a fresh checkout to a populated local app.
#
#   pnpm seed                    infra, migrations, admin user, translations, pages, the 5 demo series (published)
#   pnpm seed -- --no-series     everything except the demo series (no videos needed)
#   pnpm seed -- --demo-data     also add demo purchases, offers and reward tasks (scripts/seed_demo.py)
#   pnpm seed -- --no-infra      Docker is already up (or you use your own Postgres/Redis/MinIO)
#
# Admin login defaults to admin@katha.local / katha-local-admin; override with KATHA_SEED_ADMIN_EMAIL and
# KATHA_SEED_ADMIN_PASSWORD. Every step is safe to re-run. Needs services/api/.env (cp .env.example services/api/.env).
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="$ROOT/services/api"
PACK="$ROOT/seed/ai-series"
ADMIN_EMAIL="${KATHA_SEED_ADMIN_EMAIL:-admin@katha.local}"
ADMIN_PASSWORD="${KATHA_SEED_ADMIN_PASSWORD:-katha-local-admin}"

infra=1 series=1 demo=0
for a in "$@"; do
  case "$a" in
    --no-infra) infra=0 ;;
    --no-series) series=0 ;;
    --demo-data) demo=1 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }
command -v uv >/dev/null || { echo "uv is required: https://docs.astral.sh/uv/" >&2; exit 1; }
[ -f "$API/.env" ] || { echo "services/api/.env is missing. Run: cp .env.example services/api/.env" >&2; exit 1; }

if [ "$infra" = 1 ]; then
  step "Starting Postgres, Redis, MinIO and Mailpit"
  docker compose -f "$ROOT/infra/docker/compose.yaml" up -d --wait
fi

cd "$API"
step "Installing Python dependencies and applying migrations"
uv sync --extra dev
uv run alembic upgrade head

step "Admin user, categories and settings"
uv run python scripts/seed.py --admin-email "$ADMIN_EMAIL" --admin-password "$ADMIN_PASSWORD"

step "UI translations"
uv run python scripts/seed_translations.py ../../apps/web/src/i18n/en.json ../../apps/mobile/src/i18n/en.json

if [ -f scripts/seed_pages.py ]; then
  step "CMS pages"
  uv run python scripts/seed_pages.py
fi

if [ "$demo" = 1 ]; then
  step "Demo purchases, offers and reward tasks"
  uv run python scripts/seed_demo.py
fi

if [ "$series" = 1 ]; then
  step "Demo series (5 Hindi series, 32 episodes)"
  if ! find "$PACK" -name video.mp4 -print -quit | grep -q .; then
    cat >&2 <<MSG
The demo videos are not in $PACK (they are too large for git).
Get katha-seed-videos.zip from the project owner and unpack it at the repository root:
    unzip katha-seed-videos.zip -d "$ROOT"
or build them from the delivered masters:
    scripts/encode-seed-videos.sh <masters folder>
Then run this again. To skip the demo series for now: pnpm seed -- --no-series
MSG
    exit 1
  fi
  worker_pid=""
  if pgrep -f "worker.main.WorkerSettings" >/dev/null; then
    echo "A worker is already running; using it."
  else
    echo "Starting a worker for the video encoding (stopped again when this finishes)."
    uv run --no-sync --project ../worker arq worker.main.WorkerSettings >"$ROOT/.seed-worker.log" 2>&1 &
    worker_pid=$!
    trap '[ -n "$worker_pid" ] && kill "$worker_pid" 2>/dev/null || true' EXIT
  fi
  uv run python scripts/import_ai_series.py --apply --publish
fi

step "Done"
echo "Admin console: http://localhost:3001   login: $ADMIN_EMAIL"
echo "Start the apps: pnpm api:dev, pnpm --filter web dev, pnpm --filter admin dev"
