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

## mobile (tranche 1)

- **Force update**: `config.mobile.min_version_code` is compared against the native build number
  (`expo-application` `nativeBuildVersion`: Android `versionCode`, iOS `CFBundleVersion`). iOS build numbers may be
  dotted (`1.0.3`), so the app parses the leading integer; keep iOS `CFBundleVersion` a plain integer (EAS
  `autoIncrement` does) or the comparison degrades. Builds with no native build number (Expo Go, web) are never
  blocked. `config.mobile.update_url` is used when set; otherwise the app builds a Play Store URL from the package
  name, and on iOS falls back to an App Store *search* URL because there is no App Store id anywhere in the API or
  the config — a `mobile.ios_app_id` (or a platform-aware `update_url`) would remove that guess.
- **Clear cache**: My > Settings clears the app's own caches — the AsyncStorage `configCache` and
  `messages:<lang>` bundles, plus `expo-image`'s memory and disk caches — and then re-fetches `/v1/config`.
  expo-video 57 exposes no cache API on `VideoPlayer` (no `clearCache`, no cache directory), so buffered HLS
  segments are left to the OS; the row's copy does not promise to free video storage.
- **Events**: the app batches to `POST /v1/events` every 10 s or 20 events, and flushes on AppState
  `background`/`inactive` with a `keepalive` fetch (React Native's fetch ignores `keepalive`, so a flush during a
  kill can still be lost; the batch is re-queued on network failure and sent on next launch only if the process
  survives — there is no on-disk queue). Batches are capped at the API's 200 events, and the in-memory queue at
  400. `device` carries `{model, os, os_version, ram_gb, network, app_version, version_code}` from expo-device,
  expo-constants/expo-application and expo-network. `session_id` is a client-side UUID; the API prefers the
  server session for signed-in users, so client and server session ids differ for guests.
- Event names sent: `app_open`, `series_view`, `paywall_view`, `unlock`, `checkout_start`, `checkout_return`,
  `search`, `share`, `login`, `signup`; QoE: `play_start`, `first_frame` (`ttff_ms` from `play()` to the first
  `playingChange` true), `rebuffer` (`duration_ms` across a `statusChange` `loading` → `readyToPlay` while
  playing), `bitrate_switch` (from expo-video's `videoTrackChange`, with `bitrate`/`width`/`height`),
  `play_error`, `play_complete`, `seek`. `screen_view`, `episode_view`, `unlock_view` and `play_pause` are in the
  API's `ALLOWED` list but not sent yet.
- `bitrate_switch` reports `peakBitrate ?? averageBitrate ?? bitrate`; on HLS the values are only as good as the
  manifest's `BANDWIDTH` attributes, and iOS often reports `null` for the size, so the QoE dashboard should treat
  those fields as optional.
- **For You**: the `for_you` home rail renders after Continue Watching. It only appears for signed-in viewers with
  enough history (`recommend.for_you_ids`), so it is absent for guests by design; the app just skips it.
- **Offers and coupons**: `GET /v1/wallet/offers` cards show `discount_pct` and a live countdown to `ends_at`.
  Tapping a card selects it for the next purchase; a typed coupon wins over a selected offer (the API resolves
  only one — `coupon_code` short-circuits `offer_id`). Checkout is a two-step flow: `POST /v1/purchases/checkout`
  first, show the returned `amount`/`discount_pct` in a confirmation sheet, then open `checkout_url`. This creates
  a `Purchase` row per price check, so abandoned confirmations leave `pending` purchases behind — a dry-run/quote
  endpoint (`POST /v1/purchases/quote`) would avoid that.
- `OfferOut` has no `pack_id` name or price preview, so a pack-specific offer renders as "Applies to one pack"
  until the viewer picks that pack. `discount_pct` is nullable in the schema even though the UI has nothing to
  show without it.
- Coupon error codes are mapped to friendly copy: `coupon_invalid`, `coupon_exhausted`, `coupon_inactive` /
  `coupon_expired`, `coupon_region`, `coupon_first_purchase`, `offer_unavailable`, `offer_pack_mismatch`. There is
  no endpoint to validate a coupon before checkout, so the code is only checked when the viewer picks a pack.
- **Age gate**: `/play` answers 403 `age_gate_required` and `/unlock` answers 409 `age_gate_required`; both open a
  confirm sheet that `PATCH`es `/v1/auth/me {age_confirmed: true}` and retries. `UserOut.age_confirmed_at` gates
  re-asking. Guests never see the sheet: `/play` returns 401 for adult titles without a session, so the app shows
  its sign-in path first. There is no flag on `SeriesCard`/`SeriesDetail` marking a title as adult
  (`content_rating` is not exposed), so the app cannot warn before the request — it can only react to the error.
- **Region**: `expo-localization`'s region code is sent as `country` on `/v1/wallet/packs` and
  `/v1/purchases/checkout` (upper-cased, `*` when the OS reports none) and as an `X-Katha-Country` header on every
  request, which is the only way `/v1/wallet/offers` can learn the region (it takes no query or body parameter).
  The header is trusted only when no CDN geo header is present, so production behaviour follows the edge.
- **EAS**: `apps/mobile/eas.json` adds `development` (dev client, internal), `preview` (internal, `APP_ENV=preview`)
  and `production` (store, `autoIncrement`) with `cli.appVersionSource: "remote"`. `eas init` has not been run, so
  `app.json`'s `extra.eas.projectId` is still empty and builds will fail until someone links the project. Required
  secrets are listed in `apps/mobile/README.md`.

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

## admin (tranche 1)

Screens added: experiments, feature flags, offers & coupons, moderation queue, dashboard Quality/Funnel
tabs, series distribution + moderation fields, episode drip scheduling, admin password reset, ad placements.

- **`/v1/admin/ad-placements` does not exist.** The ads screen (`/ads`) is built against a local typed stub
  (`apps/admin/src/lib/ad-placements.ts`, in-memory, lost on reload) and is hidden from the sidebar via
  `hidden: true` in `lib/nav.ts`. Needed to close it: `GET /v1/admin/ad-placements`,
  `POST /v1/admin/ad-placements`, `PUT /v1/admin/ad-placements/{id}`, `DELETE /v1/admin/ad-placements/{id}`
  with `{name, slot, provider, unit_id, platforms[], reward_coins, frequency_cap_sec, is_active, sort_order}`.
  Proposed slots `home_rail | player_pre | player_mid | unlock_rewarded | paywall`, providers
  `admob | meta | house`. The apps also need the active placements on `GET /v1/config` for the
  `rewarded_ads` flow to supply an `ad_event_id`.
- `ExperimentOut.variants` and `.allocation` are typed `dict` (`{[key: string]: unknown}`), while
  `ExperimentIn` is `dict[str, dict]` / `dict[str, int]`. The admin guards allocation values with a
  `typeof === "number"` check when rendering. Typing the Out model like the In model would remove the guard.
- `PUT /v1/admin/experiments/{key}` rejects a changed variant *set* once started (409 `running`) but
  accepts changed allocations. The dialog locks variant names and the Add/Remove buttons after start;
  there is no API signal for "editable" beyond `started_at`, so this rule is duplicated client-side.
- Restarting an ended experiment reuses `POST /experiments/{key}/start`, which clears `ended_at`. There is
  no separate "resume" and no warning that results then span both runs — the admin labels the button
  "Restart" and says so in the confirm dialog.
- `GET /v1/admin/experiments/{key}/results` has no date-range parameter: it always counts from
  `started_at` (or the year 2000 for a draft). No way to compare two windows of a long-running test.
- `VariantResult.purchasers` is computed per (variant, currency) and then `max()`-ed across currencies, so
  for a variant with buyers in several currencies it is a lower bound, not the true distinct count. Shown
  as-is; a single `count(distinct user_id)` per variant would be exact.
- Feature flag keys cannot be renamed: `PUT /v1/admin/flags/{key}` upserts, so renaming would silently
  create a second flag. The dialog disables the key when editing and says to delete and recreate.
- `FlagIn.rules` is an untyped `dict`. The admin offers a JSON editor with the shape from the router
  comment (`platforms`, `countries`, `min_app_version`, `percentage`) as a hint only — nothing validates
  those keys, so a typo silently targets nobody. A typed `FlagRules` model would catch it server-side.
- `OfferIn.eligibility` is an untyped `dict` too. The admin gives helpers for `countries` (ISO-2 chips) and
  `inactive_days` (number), passes anything else through a JSON editor, and defaults `first_purchase: true`
  for the `first_purchase` kind. The API validates none of this.
- No `DELETE /v1/admin/offers/{id}`: offers can only be deactivated (`is_active: false`). The list shows
  Activate/Deactivate instead of a delete action.
- `OfferOut` has no `created_at`/`updated_at`, so the list cannot show when an offer was last changed even
  though `GET /offers` orders by `created_at desc`.
- Coupon codes are globally unique (409 `code_taken`) but the error does not say which offer holds the
  code, so the admin can only report "code exists".
- `CouponOut` has no per-coupon redemption list or timestamps — only `used`. No way to see who redeemed
  what from the admin.
- `GET /v1/admin/moderation` returns open reports plus flagged series with no pagination and a hard cap of
  200 each; the page loads all of it and filters client-side. A busy queue would silently truncate.
- `ModerationItem.id` is the report id for reports and the *series* id for flagged series, so the two kinds
  share an id space. The admin keys rows by `${kind}:${id}` to avoid a React key collision.
- `POST /v1/admin/moderation/series/{id}` with `action: "set_rating"` silently no-ops when
  `content_rating` is missing (the router's `elif` requires both). The admin always sends a rating for that
  action; an explicit 422 would be safer.
- `moderate_series` has no "resolve/dismiss" for a flagged series other than `clear_flags`, and no audit
  trail: who cleared which flag and when is not recorded anywhere the admin can read back.
- `ModerateSeriesIn.content_rating` is a free-form `str | None` (the column is `String(8)`); there is no
  enum. The admin offers U / UA7 / UA13 / UA16 / A from a local list (`lib/ratings.ts`) that duplicates
  `settings.adult_ratings` (`["A", "UA16"]`). Exposing the rating vocabulary on `/v1/config` would remove
  the duplication.
- `GET /v1/admin/analytics/qoe` returns `date` as a plain string and one row per (day, platform) with no
  totals; the admin computes play-weighted p50/p95/rebuffer/error aggregates client-side. Rows only exist
  where a `first_frame` event landed, so a day with rebuffers but no starts is invisible.
- QoE percentiles read `props.ttff_ms` off `AnalyticsEvent`; there is no server-side validation that the
  apps send it. A platform that omits `ttff_ms` shows `null` p50/p95 while still counting plays.
- `FunnelOut.steps` is `list[dict]`, so the admin re-asserts `{name, users}` locally. The step list is
  hard-coded server-side (`app_open` … `checkout_start`, plus `paid`) with no way to add a step or break the
  funnel down by platform, country or experiment variant.
- Funnel steps are counted independently (distinct users per event in range), not as a true sequential
  funnel, so a later step can exceed an earlier one. The admin says so on the page and shows
  "% of previous" as informational only.
- `POST /v1/admin/auth/forgot` and `/reset` return an untyped `dict` (`{ok: true}`) rather than `Ok`. The
  reset link's base comes from the server's `admin_base_url` setting, so a deployment whose admin runs on a
  different origin sends links to the wrong host — the admin cannot detect or correct this.
- `POST /v1/admin/auth/reset` raises `Unauthorized` (401) for a weak password as well as for a bad token.
  The admin's global 401 handler would normally bounce to `/login`, so `/reset` and `/forgot` are
  registered as public paths in `proxy.ts` and the page renders the message inline instead. A 422 for
  validation would be cleaner.
- The reset flow does not sign the admin in or revoke existing sessions: after a successful reset the page
  redirects to `/login`, and any other live session with the old token keeps working until it expires.
- `SeriesIn.territories` and `visible_languages` are free-form `list[str]` with no validation; the admin
  enforces ISO-3166 alpha-2 for territories and offers language checkboxes from `GET /v1/admin/languages`.
- `window_starts_at` / `window_ends_at` are not validated as an ordered pair server-side; the series form
  rejects an end before the start locally.
- `moderation_flags` is writable through `PUT /v1/admin/series/{id}`, so "clear flags" in the series editor
  is a plain field edit while the moderation queue uses the dedicated action endpoint. Two paths to the
  same state, with no audit on either.
- `EpisodeIn.scheduled_at` has no server-side rule tying it to a status: a `published` episode can carry a
  future `scheduled_at` and a `draft` one is never picked up by the worker. The episode dialog blocks the
  first case and warns on the second, but the API accepts both.
- `AdminEpisodeOut.scheduled_at` gives no signal about whether the drip worker is running or when it last
  ran, so a "scheduled" badge cannot distinguish "waiting" from "worker is down".
- `GET /v1/admin/ai/series/{id}/transcript` returns the transcript as one blob with no per-episode
  boundaries; the metadata panel truncates it to the 4000-character seed limit from the start of episode 1.
- `POST /v1/admin/ai/reembed-all` returns a single `JobOut` for the whole catalogue with no progress or
  item count, so the admin can only report "queued" — `GET /v1/admin/ai/jobs/{id}` gives status but no
  "N of M series done".

## api responses to the mobile tranche-1 gaps (2026-09-07)

- ✅ `POST /v1/purchases/quote` prices a pack with any offer or coupon applied and creates nothing, so a confirmation sheet no longer leaves abandoned `pending` purchases. Also validates a coupon before a pack is committed.
- ✅ `SeriesCard.content_rating` and `SeriesCard.is_adult` let clients pre-warn on adult titles instead of only reacting to the 403.
- Still open: no App Store id in `config.mobile` for the iOS update URL (add one alongside `update_url` when the app exists); no on-disk event queue, so a flush during a process kill can lose a batch.
