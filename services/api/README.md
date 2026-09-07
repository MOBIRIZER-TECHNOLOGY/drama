# katha-api

FastAPI service: auth exchange, catalogue, wallet ledger, unlocks, playback grants, remote config, admin.

## Run locally

```bash
# from repo root
pnpm infra:up                       # Postgres (pgvector), Redis, MinIO, Mailpit
cd services/api
cp ../../.env.example .env          # then fill KATHA_FIREBASE_* for real sign-in
uv sync --extra dev
uv run alembic upgrade head
uv run python scripts/seed.py --admin-email you@example.com --admin-password 'change-me'
uv run uvicorn app.main:app --reload --port 8000
```

Docs at http://localhost:8000/docs. Export the OpenAPI document for the TypeScript client with
`uv run python scripts/export_openapi.py ../../packages/api-client/openapi.json`.

## Layout

- `app/core` settings, database session, JWT and password helpers, Firebase verifier, error types
- `app/models` SQLAlchemy 2 models by domain: identity, catalog, wallet, engagement, ops
- `app/services` business rules: `ledger.post` is the only writer of coin balances, `access.unlock_episode` is the unlock transaction
- `app/api/routers` HTTP surface under `/v1`
- `alembic` migrations. `scripts/render_initial_migration.py` regenerates `0001_initial.py` from the models offline

## Phase 1 surface

- Rewards: `GET/POST /v1/rewards/checkin`, `GET /v1/rewards/tasks`, `POST /v1/rewards/tasks/{id}/claim`
- Engagement: favourite/like/view, `PUT /v1/episodes/{id}/progress`, `GET /v1/me/list`, reports, contact
- Purchases: `POST /v1/purchases/checkout` (Stripe Checkout or Razorpay order) + `GET /v1/purchases/{id}`; webhooks at `/v1/webhooks/stripe` and `/v1/webhooks/razorpay`
- Content: languages, `GET /v1/translations/{lang}`, CMS pages
- Admin: dashboard, series/episodes/categories, packs with regional prices, reward tasks, users (ban, coins, VIP, ledger), languages and translations (+ AI job), pages, reports, inbox, settings namespaces, admin accounts, presigned uploads and video asset status

Worker: `uv run arq worker.main.WorkerSettings` in `services/worker` (needs ffmpeg on PATH) transcodes uploads to an HLS ladder and runs the translation graph.

## Invariants

- Every coin movement is a ledger row with a unique idempotency key; `users.coin_balance` is updated in the same transaction.
- No endpoint returns a media URL except `POST /v1/episodes/{id}/play`, which checks access first and signs a short-lived URL per user.
- Purchases are created `pending` by the API and flipped to `paid` only by a verified webhook (phase 1 wires Stripe and Razorpay).
- Secrets come from the environment. The `settings` table holds only admin-editable toggles.
