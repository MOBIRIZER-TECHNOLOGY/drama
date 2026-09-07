# Katha mobile

Expo SDK 57 + Expo Router app for the Katha short-drama product. Bundle id `com.mobirizer.katha`, scheme `katha`.
Read `docs/frontend-brief.md` at the repo root before changing anything here.

## Run

```bash
cp apps/mobile/.env.example apps/mobile/.env   # fill in Firebase + Google client IDs
pnpm install
pnpm --filter mobile start                      # Metro; press a / i for a dev client or emulator
pnpm --filter mobile typecheck
pnpm --filter mobile lint
```

`expo-video`, `expo-secure-store`, `react-native-pager-view` and `react-native-webview` need native code: use a development
build (`npx expo run:android` / `run:ios` or EAS), not Expo Go.

## Layout

```
src/app/                 Expo Router routes
  _layout.tsx            providers, dark theme, onboarding gate (Stack.Protected)
  onboarding.tsx         3 pages; language picker from GET /v1/config
  auth.tsx               email/password + Google (Firebase JS SDK); phone OTP is a phase-2 TODO
  (tabs)/                Home, Shorts (guests can watch free episode 1), My List, My (avatar, delete account)
  series/[id].tsx        series detail + episode grid
  player/[seriesId].tsx  vertical episode pager, <=3 VideoPlayers, unlock sheet, progress, CC toggle (VTT overlay)
  wallet/                packs + Stripe checkout, ledger
  rewards.tsx            check-in strip + tasks
  purchase.tsx           katha://purchase return target
  page/[slug].tsx        CMS pages (privacy/terms fallback)
  language.tsx           language setting
src/providers/           ConfigProvider (config, language, translations), AuthProvider (tokens, user, balance)
src/lib/                 api client + secure-store tokens, firebase, play grants, purchases, storage
src/components/          UI kit on @katha/tokens, rails, cards, player pieces, unlock sheet
```

Phase-2 stubs are marked `TODO(phase 2)`: phone OTP (native Firebase), Razorpay, RevenueCat, rewarded ads.

## EAS builds

`eas.json` defines three profiles. `cli.appVersionSource` is `remote`, so EAS owns the build number and the
production profile auto-increments it; `app.json`'s `version` stays the marketing version.

| Profile | Distribution | `APP_ENV` | Notes |
|---|---|---|---|
| `development` | internal | `development` | dev client (`developmentClient: true`), Android APK, iOS simulator build |
| `preview` | internal | `preview` | release JS against the preview API, Android APK for testers |
| `production` | store | `production` | Android App Bundle, `autoIncrement: true` |

```bash
npx eas-cli build --profile preview --platform android
```

`eas init` has not been run (it needs an account): the project is not linked yet, so `extra.eas.projectId` in
`app.json` is still empty. Run `npx eas-cli init` once with the Expo account that owns the app, then builds work.

### Required EAS secrets

Set these on the EAS project (`npx eas-cli env:create --scope project`, or the "Environment variables" page) for
the `preview` and `production` environments. Everything prefixed `EXPO_PUBLIC_` is embedded in the JS bundle and
is public by design; none of these is a private key.

| Variable | Used by | Notes |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `src/lib/api.ts` | Overrides the per-profile host in `app.config.ts`. Must be `https` in release builds — the app refuses to start otherwise. |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | `src/lib/firebase.ts` | Firebase web app config. Optional when `GET /v1/config` returns `firebase`, which takes precedence. |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | same | |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | same | |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | same | |
| `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | same | |
| `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` | same | |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google sign-in | The client id Firebase verifies. |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google sign-in (iOS) | |
| `GOOGLE_IOS_URL_SCHEME` | `app.config.ts` (prebuild) | Reversed iOS client id, e.g. `com.googleusercontent.apps.1234-abcd`. Build-time only, not in the bundle. |

Credentials EAS manages itself (Android keystore, iOS distribution certificate and provisioning profile) are not
listed here; `eas credentials` handles them on first build.

## Before a real build

- `assets/images/*.png` are generated placeholders (a "K" mark); replace with the designed icon set.
- Google sign-in needs the web + iOS OAuth client ids (`.env.example`) and the Android SHA-1 registered in Google Cloud.
- Sign in with Apple needs the capability on the App ID; `usesAppleSignIn` is already set in `app.json`.
- Universal links need `https://katha.app/.well-known/apple-app-site-association` and `assetlinks.json` (see `docs/frontend-gaps.md`).
- `app.config.ts` maps `APP_ENV` to the API host; the preview/production hosts are placeholders.
