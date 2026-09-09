# End-to-end tests

Against the running stack — the real API, the real database, the real media host. Nothing is stubbed.

There is a second, smaller suite in `apps/web/e2e` that runs the web app against a mock API. That one exists
to catch rendering regressions in CI without a database, and it is not a substitute for this: a mock is
written to match the code as it was, so it agrees with the code even when the code is wrong. Every defect
listed at the bottom of this file was invisible to it.

## Running

The suite does not start any servers. Owning the ports would mean running it knocked over whatever the
developer had running, so bring the stack up first:

```bash
pnpm db:native                                  # Postgres
pnpm api:dev                                    # API on :8001
python scripts/serve-media.py --directory ref/videos --port 8090
pnpm dev                                        # web :3000, admin :3001

pnpm e2e            # everything
pnpm e2e:web        # the viewer app
pnpm e2e:admin      # the console
```

Point it elsewhere with `E2E_WEB_URL`, `E2E_ADMIN_URL` and `E2E_API_URL`.

### Mobile

Mobile is a separate runner, because it drives an installed APK on a device rather than a browser:

```bash
pnpm e2e:mobile     # Maestro flows in apps/mobile/e2e, against an emulator or a phone
```

It needs the app installed and pointed at an API the device can reach — `apps/mobile/README.md` covers the
build, and `apps/mobile/scripts/e2e-android.sh` prints what is missing.

## How it is put together

**Accounts.** `services/api/scripts/seed_e2e.py` creates a deterministic admin and viewer, resets the
viewer's wallet, unlocks, check-ins and reward claims, and mints a session. The suite runs it before every
run, so the arithmetic in the wallet tests is checkable and the unlock tests start from a locked episode.

Resetting *both* the unlocks and the ledger matters: `unlock_episode` posts its charge under the idempotency
key `unlock:{user}:{episode}`, and `ledger.post` returns the existing row for a key it has seen before —
right for a retried request, and quietly wrong for a test fixture. Clearing the unlock without the ledger
row makes the next run unlock the episode again for free, and the suite watches an episode open without
being charged and calls it a pass.

**Signing in.** The console signs in through its own form, so that path is exercised for real, once, in
`global.setup.ts`. The viewer app signs in through Firebase, so its session is injected instead — a real
token minted by the API, put where `apps/web/src/lib/token-store.ts` looks for it. Driving Google's sign-in
from a test would add a network round trip and a per-developer account to every run, and would fail for
reasons that have nothing to do with Katha.

**One worker.** The whole suite drives one viewer account and one admin account against one database. Run in
parallel, one test claims a daily reward while another asserts the balance after a purchase, and the
arithmetic stops meaning anything.

**Broken resources.** `support/checks.ts` watches each page for CSP violations, failed requests and 4xx/5xx
responses, because none of those fail a test on their own: the page still renders, headings still match, and
the product is broken. `expectVideoAdvances` waits for `currentTime` to move rather than for a `<video>` to
exist, for the same reason — an element that never decodes looks identical to one that does.

## What this suite found

Written against a stack that had been demonstrated by hand and had 177 passing unit tests. In order of
severity:

| Defect | Effect |
|---|---|
| `GET /v1/admin/users/{id}` had two handlers | The first served a plain account, the second — the one the spec, the generated client and the console all describe — never ran. The support drawer crashed on every account. |
| `AdminUserDetail.model_validate(user)` read a lazy relationship | The real handler, once it could run, raised `MissingGreenlet`. Two faults on one endpoint, each hiding the other. |
| A failed recommendation query was caught but not rolled back | Postgres aborts a transaction after any failed statement, so the *category* query further down `/v1/home` failed and the home page 500'd for every signed-in viewer with watch history. |
| Unhandled 500s bypassed CORS | Starlette answers exceptions outside every middleware, so a server error reached the browser as a CORS error with no status and no body. Every 500 looked like a misconfigured API. |
| Creating a category with no translations 500'd | `lazy="selectin"` does not apply to a row that was just inserted. It only failed with an empty translation map — which is exactly what the console's form posts. |
| Web `img-src` omitted the media origins | Invisible in production, where `https:` covers it; on any http deployment every cover and thumbnail was blocked. |
| Admin `font-src` omitted `'self'` | The console's own bundled fonts were blocked everywhere, falling back to system faces. |
| The admin drama list rendered cover *keys* | Resolved against the console's own origin, so every thumbnail 404'd. |
| The local media server sent no CORS and no Range | Native players do not care, so mobile played perfectly while the web player was dead — and the difference looked like a bug in the web player. |
