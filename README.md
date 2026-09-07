# Katha

Short-drama streaming: vertical episodes, coin unlocks, VIP, rewards. Rebuilt from the SnapReels feature set on
FastAPI + Postgres, Next.js (web and admin) and React Native (Expo). Plan and source analysis live in `docs/`.

## Layout

```
apps/web         Next.js public site
apps/admin       Next.js admin panel
apps/mobile      Expo React Native app  (com.mobirizer.katha)
packages/api-client   TypeScript client generated from the API's OpenAPI document
packages/tokens       design tokens shared by web and mobile
services/api     FastAPI + SQLAlchemy + Alembic
services/worker  arq jobs: transcode, webhooks, push, AI graphs
services/ai      LangGraph graphs and the LLM provider registry
infra/docker     local Postgres (pgvector), Redis, MinIO, Mailpit
docs/            rebuild plan, SnapReels analysis
ref/             purchased SnapReels package (local only, git-ignored)
```

## First run

```bash
corepack enable && pnpm install
pnpm infra:up                                   # needs Docker
cp .env.example services/api/.env
(cd services/api && uv sync --extra dev && uv run alembic upgrade head \
  && uv run python scripts/seed.py --admin-email you@example.com --admin-password change-me)
pnpm api:dev                                    # http://localhost:8000/docs
pnpm api:client                                 # regenerate the TS client after API changes
pnpm --filter web dev                           # http://localhost:3000
pnpm --filter admin dev                         # http://localhost:3001
pnpm --filter mobile start                      # Expo dev server
```

## Rules that keep the product safe

- Coins move only through `services/api/app/services/ledger.py`. Never update `users.coin_balance` directly.
- Media URLs come only from `POST /v1/episodes/{id}/play` after an access check. No other response carries one.
- Purchases become `paid` only from a verified webhook. Clients poll; they never assert success.
- Secrets live in the environment. The `settings` table holds toggles only.
- Every ledger row, unlock, purchase and event records the user's experiment `variant_map`.
