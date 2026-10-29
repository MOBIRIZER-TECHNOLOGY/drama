# Katha

Short-drama streaming: vertical episodes, coin unlocks, VIP, rewards. Rebuilt from the SnapReels feature set on
FastAPI + Postgres, Next.js (web and admin) and React Native (Expo). Plan and source analysis live in `docs/`.

## Quick start

You need Git access to this repository, and these installed: **Node 22+**, **pnpm** (`corepack enable`),
**Python 3.12+ with [uv](https://docs.astral.sh/uv/)**, **Docker Desktop** (running), **FFmpeg** and **unzip**.

```bash
git clone git@github.com:MOBIRIZER-TECHNOLOGY/drama.git
cd drama
pnpm bootstrap
```

`pnpm bootstrap` does everything needed once, and is safe to run again:

1. checks the tools above and that Docker is running,
2. runs `pnpm install`,
3. downloads **one file**, `katha-dev-bundle.zip` (about 430 MB), from Google Drive and verifies its checksum. It holds
   the `.env` files for the API, web, admin and mobile apps and the 32 demo videos, which are too large for git,
4. unpacks it into place without overwriting any file you already have,
5. starts Postgres, Redis, MinIO and Mailpit, applies the migrations, creates the admin user, loads translations and
   pages, imports the 5 demo series, waits for the worker to encode the videos and publishes them.

If the Drive download is blocked on your network, download the file in a browser, save it in the repository root as
`katha-dev-bundle.zip`, and run `pnpm bootstrap` again.

## Run it

Open three terminals in the repository root:

```bash
pnpm api:dev                  # API         http://localhost:8000/docs
pnpm --filter web dev         # website     http://localhost:3000
pnpm --filter admin dev       # admin       http://localhost:3001
```

Log in to the admin console with **`admin@katha.local`** / **`katha-local-admin`**. The 5 demo series are already
published, so the website shows them straight away.

A fourth process, the **worker**, is needed whenever you upload or import a video: it turns the file into the encrypted
720p/480p/360p stream. Without it an episode stays "being prepared". `pnpm bootstrap` starts one only for its own run.

```bash
cd services/api && uv run --no-sync --project ../worker arq worker.main.WorkerSettings
```

### Mobile app

```bash
cd apps/mobile
npx expo run:ios        # iOS simulator (macOS with Xcode)
npx expo run:android    # Android emulator or device
```

Set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to an address the device can reach: `http://localhost:8000` for the iOS
simulator, `http://10.0.2.2:8000` for the Android emulator, `http://<your machine's LAN IP>:8000` for a real phone.
A real iPhone also needs your Apple team in Xcode.

### Sign-in and payments

The bundle's `.env` files carry the Firebase web config, so email sign-in works from `localhost`; accounts you create are
real accounts in the shared Firebase project, so use your own test emails. **Razorpay is not in the bundle.** For test
purchases ask the owner privately for the *test-mode* key id and secret (`rzp_test_...`) and put them in
`services/api/.env`. Live keys never belong on a development machine. Google and Apple sign-in on phones also need
`GoogleService-Info.plist` and `google-services.json` from the owner.

## When something goes wrong

| Symptom | Fix |
|---|---|
| `Docker is installed but not running` | start Docker Desktop and run `pnpm bootstrap` again |
| Port already in use (5432, 6379, 9000, 8000, 3000) | stop the other program, or change the port: `KATHA_POSTGRES_PORT` / `KATHA_REDIS_PORT` and the matching URL in `services/api/.env` |
| Episodes say "being prepared" and never play | the worker is not running; start it with the command above |
| Videos missing, `pnpm seed` stops | the bundle was not unpacked; run `pnpm bootstrap` |
| Checksum mismatch after download | delete `katha-dev-bundle.zip` and run again; if it persists the owner has published a newer bundle, so `git pull` first |
| Start again from nothing | `pnpm infra:down -v` (this deletes the local database and storage), then `pnpm bootstrap` |

## Commands you will use

| Command | What it does |
|---|---|
| `pnpm bootstrap` | first-time setup described above |
| `pnpm seed` | re-run the seeding only (`-- --no-series` skips the demo series, `-- --demo-data` adds demo purchases and offers) |
| `pnpm infra:up` / `pnpm infra:down` | start or stop Postgres, Redis, MinIO and Mailpit |
| `pnpm api:client` | regenerate the TypeScript API client after an API change |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | checks for every package |
| `pnpm e2e` | browser end-to-end tests (`pnpm e2e:ios` / `pnpm e2e:mobile` for the phone flows) |
| `pnpm db:bootstrap` | migrations, seed and the full API test suite against a real database |

## Layout

```
apps/web              Next.js public site
apps/admin            Next.js admin console
apps/mobile           Expo React Native app  (com.mobirizer.katha)
packages/api-client   TypeScript client generated from the API's OpenAPI document
packages/tokens       design tokens shared by web and mobile
services/api          FastAPI + SQLAlchemy + Alembic
services/worker       arq jobs: video transcoding, webhooks, push, AI graphs
services/ai           LangGraph graphs and the LLM provider registry
infra/docker          local Postgres (pgvector), Redis, MinIO, Mailpit
seed/ai-series        the 5 AI-generated Hindi demo series (videos come in the bundle, not git)
scripts               bootstrap, seeding, video encoding and test helpers
content               series scripts and the developer seed
docs                  setup, hosting, plans and analysis
```

## More documentation

- `docs/developer-setup.md`: setup step by step, for when you want control or `pnpm bootstrap` fails.
- `seed/README.md`: the demo content, the bundle, and how to publish a new bundle (owners).
- `docs/hosting-aicanon-dev.md`: how production is hosted (nginx, TLS, pm2, the media edge).
- `docs/ai-drama-pilot.md`: the AI-drama pilot plan. All demo series are AI-generated and need a native Hindi review
  and legal review before any public release.

## Seeding by hand

`pnpm seed` runs these in order, so you only need them to run one step on its own:

```bash
cd services/api
uv run alembic upgrade head
uv run python scripts/seed.py --admin-email you@example.com --admin-password <choose one>
uv run python scripts/seed_translations.py ../../apps/web/src/i18n/en.json ../../apps/mobile/src/i18n/en.json
uv run python scripts/seed_demo.py                     # optional: demo rewards, offers and purchases
uv run python scripts/import_ai_series.py --apply --publish   # the 5 demo series (needs the worker)
```

`seed.py` creates the least the apps need to boot. `seed_translations.py` and `seed_demo.py` fill in the rest and are
safe to re-run; `seed_demo.py` settles its demo purchases through `payments.mark_paid` and earns coins through the
ledger, so what it leaves behind is a database the product itself could have produced.

## Running the database-backed tests

```bash
pnpm db:bootstrap      # Docker: migrations + seed + the full suite. The real path.
pnpm db:native         # No Docker: downloads PostgreSQL binaries, builds the schema from the models, runs pytest.
pnpm db:native:stop
```

`db:native` exists because Docker Desktop on Windows needs WSL2, which needs a reboot to enable. It skips the
`embeddings` table (pgvector is not in a stock PostgreSQL build) and does not exercise the migration chain, so
`pnpm db:bootstrap` remains what CI and a release check run.

## Rules that keep the product safe

- Coins move only through `services/api/app/services/ledger.py`. Never update `users.coin_balance` directly.
- Media URLs come only from `POST /v1/episodes/{id}/play` after an access check. No other response carries one.
- Purchases become `paid` only from a verified webhook. Clients poll; they never assert success.
- Secrets live in the environment. The `settings` table holds toggles only.
- Every ledger row, unlock, purchase and event records the user's experiment `variant_map`.
