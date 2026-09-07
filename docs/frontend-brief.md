# Katha front-end brief (web, admin, mobile)

Read this before touching `apps/*`. It is the contract between the API and the three clients.

## Repository

- `services/api` FastAPI. The OpenAPI document is committed at `packages/api-client/openapi.json`; the typed client is
  `packages/api-client` (`openapi-fetch`). **Never edit `services/*` or `packages/api-client` from an app.** If the API is
  missing something, write it down in `docs/frontend-gaps.md` and work around it.
- `packages/tokens` exports `colors`, `radii`, `spacing`, `type` for a dark-first look. Web and mobile must use these.
- Design language: near-black ground (`#141013`), madder-pink accent (`#F05A72`), coin gold (`#E0B44A`), Bricolage Grotesque
  for display, IBM Plex Sans for body. Portrait 9:16 media everywhere. Rounded 12px cards, no drop shadows, thin borders.
  This is a premium short-drama product; the vendor screenshots in `docs/snapreels-source-analysis.html` show the target UX.

## Using the client

```ts
import { createKathaClient } from "@katha/api-client";
const api = createKathaClient({ baseUrl, platform: "web" | "android" | "ios", tokens });
const { data, error } = await api.GET("/v1/home", { params: { query: { lang: "hi" } } });
await api.POST("/v1/episodes/{episode_id}/unlock", { params: { path: { episode_id } }, body: { method: "coins" } });
```

`tokens` is `{ getAccessToken(), refresh() }`. The client sets `Authorization: Bearer` and `X-Katha-Platform`, and retries
once after a 401 by calling `refresh()`. Errors come back as `{ detail: { code, message } }`; surface `message`, branch on `code`.

## Auth flow

1. Sign in with Firebase (email/password, Google, Apple on iOS, phone OTP). Firebase web config comes from
   `NEXT_PUBLIC_FIREBASE_*` / `EXPO_PUBLIC_FIREBASE_*` env vars.
2. `POST /v1/auth/exchange` with `{ firebase_id_token, platform, device_id, device_name, app_version, locale }` →
   `{ access_token, refresh_token, expires_in, is_new_user }`. Store both (web: localStorage + memory; mobile: expo-secure-store).
3. `POST /v1/auth/refresh` rotates the refresh token. `POST /v1/auth/logout` revokes the session. `GET /v1/auth/me` is the profile.
4. 401 with code `unauthorized` after a refresh attempt means sign out locally.

## Core endpoints (all under /v1; see openapi.json for shapes)

| Purpose | Endpoint |
|---|---|
| Remote config, languages, flags, experiment variants | `GET /config` |
| UI strings for a language | `GET /translations/{lang}` (flat `{key: value}`; keys are dotted, e.g. `home.continue_watching`) |
| Home rails in one call | `GET /home?lang=` → `{ rails: [{ key, title, items: SeriesCard[] }] }` |
| Catalogue | `GET /series?lang=&category=&q=&limit=&offset=`, `GET /series/{id_or_slug}?lang=`, `GET /categories` |
| Play | `POST /episodes/{id}/play` → `{ hls_url, embed_html, expires_at, resume_position_sec, next_episode_id }`. 403 when locked. URLs expire in 5 min: request again on retry. |
| Unlock | `POST /episodes/{id}/unlock` `{ method: "coins" \| "ad", ad_event_id? }` → `{ coin_balance }`. 402 `insufficient_coins`, 409 `sequential_unlock_required` / `already_accessible`. |
| Progress | `PUT /episodes/{id}/progress` `{ position_sec, completed }` every ~15s and on pause/leave |
| Engagement | `POST /series/{id}/favorite`, `/like`, `/view`; `GET /me/list`; `DELETE /me/history?series_id=` |
| Wallet | `GET /wallet`, `GET /wallet/ledger`, `GET /wallet/packs?currency=INR&country=IN` |
| Purchase | `POST /purchases/checkout` `{ pack_id, gateway: "stripe" \| "razorpay", currency, country, success_url, cancel_url }`; Stripe → redirect to `checkout_url`; Razorpay → open Checkout.js with `order_id`, `key_id`, `amount_minor`. Then poll `GET /purchases/{id}` until `status === "paid"` (webhook-driven; never assume success). |
| Rewards | `GET /rewards/checkin`, `POST /rewards/checkin`, `GET /rewards/tasks`, `POST /rewards/tasks/{id}/claim` |
| Content | `GET /pages` (footer links), `GET /pages/{slug}?lang=`, `POST /contact`, `POST /reports` |
| Admin | `POST /admin/auth/login` → admin JWT (8h). Everything under `/admin/*` needs it. Role is in the token payload (`role`). |

## Rules

- Never construct a media URL yourself. Only `/play` returns one.
- The episode list already carries `is_free`, `accessible`, `unlocked`, `price`; render lock state from those.
- Sequential unlock: only `highest accessible + 1` can be unlocked; render others as "unlock previous first".
- Language: `lang` query param on catalogue calls; UI strings from `/translations/{lang}` with English fallback baked in.
- Every screen needs loading, empty and error states. No `alert()`. No console noise in production builds.
- Typecheck (`pnpm --filter <app> typecheck`) and lint must pass. Keep dependencies minimal and pinned.
- Do not commit. Do not touch other apps.

## Mobile-specific

- Expo SDK 57, Expo Router, New Architecture. Bundle `com.mobirizer.katha`, scheme `katha`.
- Player: `expo-video`. Keep at most three `VideoPlayer` instances (previous, current, next). Preload next by calling `/play` for `next_episode_id` when it is accessible.
- Feed: `react-native-pager-view` vertical for episodes; `@shopify/flash-list` for rails.
- Tokens in `expo-secure-store`. Device id from `expo-application` (androidId / iosIdForVendor).
- Purchases: RevenueCat is phase 2. For now open the Stripe `checkout_url` with `expo-web-browser` and poll the purchase.
- Ads: phase 2. Render the "watch ad" unlock option only when `config.flags.rewarded_ads` is true (it will be false).

## Web-specific

- Next.js 16 App Router, Tailwind 4. SSR the home and series pages (fetch server-side with `lang` from the `[lang]` segment,
  default `en`). Client components for player, wallet, rewards, auth dialog.
- Player: `hls.js` (dynamic import) on a `<video>` in a 9:16 frame; native HLS on Safari. Custom controls: play/pause,
  seek, volume, fullscreen, next episode, hold-right for 2x.
- Auth dialog: Firebase JS SDK v11 (`firebase/auth`): email/password, Google popup, phone OTP with invisible reCAPTCHA.
- Razorpay: load `https://checkout.razorpay.com/v1/checkout.js` on demand; Stripe: plain redirect.
- SEO: `generateMetadata` with OpenGraph and Twitter cards on series pages; `hreflang` alternates from `/languages`.
