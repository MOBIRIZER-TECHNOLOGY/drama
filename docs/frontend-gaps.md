# Front-end gaps

Things the API does not (yet) provide, or where a client had to work around it. One section per app.
**Append to this file; do not rewrite it.** Closed items are marked ✅ with the API change that closed them.

## web

- ✅ `POST /v1/episodes/{id}/play` now accepts anonymous calls for free episodes (401 `unauthorized` only for locked ones).
- ✅ Checkout return URLs: the API now appends `purchase_id` with `&` when the URL already has a query. The parameter name is `purchase_id`; the web accepts both.
- ✅ `GET /v1/config` now has `payments.gateways` (configured and enabled, in display order), `site.captcha_site_key`, and `firebase` (public web config) when the server has them.
- ✅ `GET /v1/config` is typed (`ConfigOut`).
- Language prefixes are fixed at build time: `next.config.ts` fetches `GET /v1/languages` once and bakes `NEXT_PUBLIC_LANGS` (fallback `en,hi`). A language activated later needs a web restart before `/xx/...` routes.
- ✅ User avatar upload: `POST /v1/auth/me/avatar/presign` `{filename, content_type}` → `{upload_url, public_url}`; PUT the file, then `PATCH /v1/auth/me` with `avatar_url`.
- Reward task kinds `share` / `follow` have no defined client behaviour; the web treats them like `link` tasks. `rewarded_ad` tasks are hidden unless `flags.rewarded_ads`.
- Embedded episodes (`embed_html`) cannot report progress or auto-advance: the sandboxed iframe gives no `timeupdate`/`ended` signal. Accepted limitation for legacy embeds.
- ✅ `PlayOut` with neither `hls_url` nor `embed_html` is now a 409 `asset_not_ready`.
- Subtitles: the web renders `PlayOut.subtitles` as `<track>` elements with a CC menu; the choice is saved in
  `localStorage` (`katha.subtitles`, language code or `off`) and defaults to the UI language. Tracks on another origin
  (the CDN) need CORS (`Access-Control-Allow-Origin`) on the `.vtt` objects, since the video is loaded with
  `crossorigin="anonymous"` whenever a cross-origin track is present.
- Avatar upload: the browser PUTs straight to `upload_url`, so the avatar bucket must allow CORS `PUT` with
  `Content-Type` from the web origin (same rule as the admin uploads).
- Contact captcha: the web renders Cloudflare Turnstile when `site.captcha_site_key` is set and sends `captcha_token`;
  `POST /v1/contact` does not verify it yet (phase 2 per `engagement.py`).
- `config.payments.gateways` drives the wallet: the picker is hidden with one gateway and purchases are disabled with
  none. Unknown gateway names are ignored (only `stripe` and `razorpay` have a client flow).

## mobile

- ✅ `/play` for free episodes no longer needs a session; the Shorts feed works for guests.
- ✅ `GET /v1/config` is typed.
- ✅ `DELETE /v1/auth/me` deletes the account (scrubs PII, revokes sessions, deletes the Firebase user).
- ✅ `SeriesCard.first_episode_id` is populated on home, list, detail and similar, so Shorts needs no detail call per item.
- ✅ The `continue` home rail carries `progress` (`episode_id`, `episode_number`, `position_sec`, `duration_sec`).
- `ToggleOut.count` is optional for `/favorite` and `/like`; the app keeps an optimistic like count when absent.
- ✅ Playback grants last 15 minutes instead of 5.
- `GET /v1/wallet/packs` takes `country`; the app sends `*` until `expo-localization` is added in phase 2 (store country).
- Stripe return URL is `katha://purchase`. If Stripe rejects the custom scheme for the account, switch to an `https://katha.app/purchase` universal link handled by the app.
- Phone OTP is phase 2 behind `react-native-firebase`; `config.auth.phone` is honoured but the button is disabled.
- Ads: `flags.rewarded_ads` gates the "watch ad" unlock option and rewarded-ad tasks; inert until an ad SDK provides `ad_event_id`.
- **Universal links**: the app declares `applinks:katha.app` and the Android `/s` intent filter, and routes `https://katha.app/s/{slug}` to the series screen. The web app / CDN must serve `/.well-known/apple-app-site-association` (team id + `com.mobirizer.katha`, paths `/s/*`) and `/.well-known/assetlinks.json` (package + signing SHA-256) or the links open in the browser.
- **Stripe return on Android** is delivered twice (auth session close + OS deep link); the app resolves it with `router.dismissTo("/wallet")`. An `https` return URL would still be preferable (see the Stripe note above).
- **Sideloaded subtitles**: expo-video 57 (`VideoSource`) has no way to attach external WebVTT files; its `subtitleTrack` API only sees tracks embedded in the HLS stream. The app fetches `PlayOut.subtitles[].url`, parses the VTT itself and draws cues over the video (`apps/mobile/src/components/player/subtitles.ts`), and additionally selects an embedded track when one matches the language. If the transcoder can mux the VTT tracks into the HLS master playlist, the native renderer will be used automatically.
- `SeriesCard.first_episode_id` is optional in the schema (`?: string | null`); cards without it are skipped in the Shorts feed.
- `DELETE /v1/auth/me` returns `Ok` only; the app treats any non-2xx as "could not delete" (401 → "sign in again").
- Avatar upload: `POST /v1/auth/me/avatar/presign` → PUT to `upload_url` with the picked file's `Content-Type` → `PATCH /v1/auth/me {avatar_url: public_url}`. The presigned PUT must allow the mobile origin-less request (no CORS needed on native, but the bucket must accept the `Content-Type` header used in the signature).

## admin

- Several admin list endpoints (`/admin/series`, `/admin/purchases`, `/admin/reports`, `/admin/inbox`, `/admin/reward-tasks`) return arrays without a `total`; only `/admin/users` returns `{items, total}`.
- `GET /admin/translations/{lang}`, `GET/PUT /admin/settings/{ns}` and `dashboard.daily` are untyped (`dict`); the UI carries local types.
- No admin token refresh; the 8-hour JWT expires and the panel redirects to login.
- ✅ Admin accounts: `PUT /v1/admin/accounts/{id}` edits name, role, active flag and password (owner only; not on your own role/active).
- ✅ Video assets: `GET /v1/admin/uploads/videos?status=` lists; `DELETE /v1/admin/uploads/videos/{id}` (409 `asset_in_use`); `VideoAssetOut` now has `created_at` and `size_bytes`.
- No reply action on the inbox.
- Reward-task endpoints are gated as finance or editor; the sidebar shows them to finance only.
- ✅ Local MinIO allows CORS from http://localhost:3000 and :3001 (`MINIO_API_CORS_ALLOW_ORIGIN`). Production buckets and CDN need the same rule.
- The "secrets are not settings" rule is duplicated client-side as a hint; the API remains the enforcement point.
- No series sort parameter on `/admin/series` (always `updated_at desc`).
- `GET /v1/admin/ai/jobs/{job_id}` is used for translate/subtitles/embeddings outcome polling but is not yet in `packages/api-client/src/schema.d.ts`; the admin types the response locally in `apps/admin/src/lib/ai.ts` (`{ job_id, status, result?, error? }`) and calls it with `fetch`. Switch to the typed client once regenerated.
- Presigned uploads and public media come from a separate origin (MinIO/S3/CDN), so the admin CSP needs it in `connect-src`/`img-src`; it is configured via `NEXT_PUBLIC_UPLOAD_ORIGINS` because the API does not expose the storage origin (a `storage_public_origin` in `/v1/admin/auth/me` or config would remove the env var).

## api additions (AI, 2026-09-07)

- `POST /v1/admin/ai/series-metadata` `{seed, language?, title?, synopsis?, transcript?}` → draft title, synopsis, genres, tags, SEO, slug, content rating, moderation flags, confidence. Inline, for the "Generate with AI" button on the series form; the editor approves before saving.
- `POST /v1/admin/ai/series/{id}/translate` `{languages?}` queues title/synopsis/SEO translation into active languages (never overwrites human translations).
- `POST /v1/admin/ai/series/{id}/embeddings` queues a pgvector refresh. Series detail `similar` now uses nearest neighbours when an embedding exists; `GET /v1/series?q=` uses semantic search when embeddings exist, else title match.
- `POST /v1/admin/ai/episodes/{id}/subtitles` `{languages?}` queues transcription (Whisper) and translated WebVTT tracks. `PlayOut.subtitles` lists `{lang, url}` tracks for the player.

## api additions (tranche 1, 2026-09-07)

- `POST /v1/events` batched product and QoE events (allow-listed names; `first_frame.props.ttff_ms`, `rebuffer.props.duration_ms`, `play_error.props.code`).
- `GET /v1/home` adds a `for_you` rail for signed-in viewers with embeddings; anonymous home cached 60 s per language and country. Catalogue calls honour `visible_languages`, `territories` and licensing windows; country comes from `CF-IPCountry`, `CloudFront-Viewer-Country` or `X-Katha-Country`.
- `GET /v1/wallet/offers`; `POST /v1/purchases/checkout` accepts `coupon_code` / `offer_id` and returns `amount` and `discount_pct`; error codes `coupon_invalid`, `coupon_exhausted`, `coupon_inactive`, `coupon_region`, `coupon_first_purchase`, `offer_unavailable`, `offer_pack_mismatch`.
- Age gate: `/play` and unlock return 403 `age_gate_required` for adult-rated series until `PATCH /v1/auth/me {age_confirmed: true}`; `UserOut.age_confirmed_at`.
- `GET /v1/sitemap` feed; admin: experiments, flags, offers, coupons, moderation queue, QoE and funnel analytics, `POST /v1/admin/auth/forgot` and `/reset`; series editor fields `visible_languages`, `territories`, `window_*`, `moderation_*`; episode `scheduled_at` (drip release via worker cron).
- Media edge: `GET /v1/media/verify` for nginx `auth_request` (`infra/nginx/media.conf`, compose service `media-edge` on :8080). Set `KATHA_CDN_BASE_URL=http://localhost:8080/media` and `KATHA_CDN_SIGNING_MODE=hmac` to enforce grants locally.
