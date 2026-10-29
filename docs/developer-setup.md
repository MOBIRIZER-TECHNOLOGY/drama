# Setting Katha up on a new machine

## The short way

```bash
git clone git@github.com:MOBIRIZER-TECHNOLOGY/drama.git && cd drama
pnpm bootstrap
```

That checks your tools, installs the packages, downloads one bundle (`katha-dev-bundle.zip`: the `.env` files and the
demo videos) from Google Drive, unpacks it, and seeds the database, storage and demo series. Then run
`pnpm api:dev`, `pnpm --filter web dev` and `pnpm --filter admin dev`. You still need the tools in section 1 and
repository access. The rest of this page is the same thing step by step, for when you want control or something fails.

This gets a developer from a fresh clone to the web app, admin console, API, worker and mobile app running locally.
The short version is in the root `README.md`; this page adds what it leaves out: the worker, the demo series,
sign-in and payments, and the mobile builds.

No secrets are in the repository. Anything marked **ask the owner** is handed over privately, not committed.

## 1. What to install

| Tool | Version | Used for |
|---|---|---|
| Git, with access to `MOBIRIZER-TECHNOLOGY/drama` | any | clone and push (ask the owner to add you, or a deploy key) |
| Node | 22 or newer | web, admin, mobile |
| pnpm | via `corepack enable` | workspace installs |
| Python and `uv` | 3.12 or newer | API, worker, AI service |
| Docker Desktop | current | Postgres (pgvector), Redis, MinIO, Mailpit |
| FFmpeg | 6 or newer | the worker builds the video streams with it |
| Xcode (Mac only) | current | iOS simulator and device builds |
| Android Studio | current | Android emulator and builds |
| Maestro | current | the mobile end-to-end flows |

Docker Desktop must be running before step 3, and set to start at login if the machine is a server.

## 2. Clone and install

```bash
git clone git@github.com:MOBIRIZER-TECHNOLOGY/drama.git
cd drama
corepack enable && pnpm install
```

## 3. Start the data stores

```bash
pnpm infra:up        # Postgres 5432, Redis 6379, MinIO 9000 (console 9001), Mailpit 1025/8025
```

## 4. API and database

```bash
cp .env.example services/api/.env      # skip if the bundle gave you one
cd services/api
uv sync --extra dev
uv run alembic upgrade head
uv run python scripts/seed.py --admin-email you@example.com --admin-password <choose one>
uv run python scripts/seed_translations.py ../../apps/web/src/i18n/en.json ../../apps/mobile/src/i18n/en.json
uv run python scripts/seed_demo.py           # optional: demo rewards, offers, purchases
pnpm --dir .. api:dev                        # API on http://localhost:8000/docs
```

The ports above are the defaults in `infra/docker/compose.yaml` and match `.env.example`. If something else on
your machine already uses one, change `KATHA_POSTGRES_PORT` or `KATHA_REDIS_PORT` and the matching URL in `.env`.
The production server in `docs/hosting-aicanon-dev.md` uses different ports (5433, 6380, API on 8071).

## 5. The worker

The worker turns uploaded videos into encrypted HLS (1080p, 720p, 480p and 360p, never upscaled) and runs the
scheduled jobs. Without it, uploaded episodes stay "being prepared".

```bash
cd services/api
uv run --no-sync --project ../worker arq worker.main.WorkerSettings
```

## 6. Web, admin and mobile

```bash
pnpm --filter web dev          # http://localhost:3000
pnpm --filter admin dev        # http://localhost:3001
pnpm --filter mobile start     # Expo dev server
```

The bundle already placed these files. Otherwise copy `apps/web/.env.example` and `apps/mobile/.env.example` to `.env.local` and `.env`. For the mobile app set
`EXPO_PUBLIC_API_URL` to an address the phone can reach: `http://10.0.2.2:8000` for the Android emulator, your
machine's LAN address for a real phone, `http://localhost:8000` for the iOS simulator.

## 7. Demo content

The five series are in `seed/ai-series/` (scripts, covers, thumbnails, subtitles in git). The videos are not; they
come in the bundle. If you used `pnpm bootstrap` (see the top of this page) this is already done. To redo just this
step: `pnpm seed`. Layout, options and how to verify the videos are in `seed/README.md`.

## 8. Sign-in and payments (optional locally)

The apps run without them; email sign-in and coin purchases are then unavailable.

- **Firebase sign-in:** create a Firebase project, enable Email/Password (and Google if wanted), add `localhost` to
  Authorized domains, and put the project ID and web config into `KATHA_FIREBASE_PROJECT_ID` and the
  `KATHA_FIREBASE_WEB_*` values. The API only needs the project ID to verify tokens. **Ask the owner** before using
  the shared `katha-8db97` project, or make your own.
- **Razorpay:** use **Test Mode** keys only (`rzp_test_...`) in `KATHA_RAZORPAY_KEY_ID` and
  `KATHA_RAZORPAY_KEY_SECRET`. Purchases only complete through the webhook (`POST /v1/webhooks/razorpay`, events
  `payment.captured` and `refund.processed`, secret in `KATHA_RAZORPAY_WEBHOOK_SECRET`). A local machine needs a
  tunnel (for example `cloudflared`) for Razorpay to reach it. Never put live keys on a developer machine.

## 9. Video protection

Locally, `KATHA_CDN_SIGNING_MODE=none` leaves video links open. In production it is `hmac`, nginx checks each
signed, expiring link, and the key endpoint is rate limited. Do not copy that production setting into a dev `.env`
without also running the nginx rules in `nginx/aicanon.dev.conf`.

## 10. Check that it works

```bash
pnpm typecheck && pnpm test              # web, admin, packages
pnpm db:bootstrap                        # API tests against a real database (Docker)
pnpm e2e                                 # browser end-to-end
pnpm e2e:ios                             # Mac with Xcode: mobile flows on the simulator
```

## 11. iOS and Android builds

- **iOS simulator:** `cd apps/mobile && npx expo run:ios`. Release builds are used for the Maestro flows because a
  debug build breaks when the flow clears app state.
- **iPhone:** needs your Apple team in Xcode. Push, Sign in with Apple and Associated Domains need the account
  holder to accept the latest Apple Program License Agreement; until then build with an empty entitlements file.
- **Android:** `cd apps/mobile && npx expo run:android`. A release APK needs `KATHA_KEYSTORE_PASSWORD`,
  `KATHA_KEY_ALIAS` and `KATHA_KEY_PASSWORD` (**ask the owner**).
- **Google and Apple sign-in on phones** also need `GoogleService-Info.plist` (iOS) and `google-services.json`
  (Android) from the Firebase project.

## 12. Running it as a server

The production setup, nginx rules, certificate renewal and process manager are described in
`docs/hosting-aicanon-dev.md`. Those files and `deploy/` hold secrets and are git-ignored.

## House rules

- Coins move only through `services/api/app/services/ledger.py`.
- Media URLs come only from `POST /v1/episodes/{id}/play` after an access check.
- A purchase is `paid` only from a verified webhook.
- Secrets live in the environment, never in the repo or the `settings` table.
- The series are AI-generated: keep the disclosure line, and have a native Hindi speaker and counsel review the
  Hindi and legal text before launch.
