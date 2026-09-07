# Katha admin

Operations console for the Katha short-drama platform. Next.js 16 (App Router), Tailwind 4, TypeScript, port 3001.

```bash
pnpm --filter admin dev        # http://localhost:3001
pnpm --filter admin typecheck
pnpm --filter admin lint
pnpm --filter admin build      # no API needed: every page fetches client-side after login
```

Configure `NEXT_PUBLIC_API_URL` (see `.env.example`; defaults to `http://localhost:8000`).

## How it works

- **Auth**: `/login` posts to `POST /v1/admin/auth/login`; the JWT is stored in `localStorage` and a cookie
  (`katha_admin_token`). `src/proxy.ts` redirects visitors with no cookie to `/login`; `src/lib/auth.tsx` loads
  `GET /v1/admin/auth/me` and any 401 from the API clears the token and returns to `/login`.
- **API**: `src/lib/api.ts` wraps `@katha/api-client` with the token store; `call()` unwraps responses into
  data-or-throw with human-readable messages from `{ detail: { code, message } }` and 422 validation errors.
- **Roles**: `src/lib/nav.ts` decides which sidebar sections a role sees (owner: all; editor: dramas, categories,
  languages, pages; support: users, reports, inbox; finance: packs, purchases, users, rewards, settings).
- **Uploads**: `src/lib/uploads.ts` — presign, `PUT` to storage (with progress), register videos and poll every 3s.
- **Theme**: light; accent, gold and status colours come from `@katha/tokens` via CSS variables set in `app/layout.tsx`.
- **Security headers**: `next.config.ts` sets a CSP (`connect-src` = self + `NEXT_PUBLIC_API_URL` + `NEXT_PUBLIC_UPLOAD_ORIGINS`),
  `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`; `script-src` allows inline scripts because Next.js
  hydration needs them (nonce-based CSP is a later phase). `src/proxy.ts` decodes the JWT (`jose`) to bounce expired
  tokens and roles that cannot use a section.
- **Forms**: `src/lib/forms.ts` — `useFieldErrors()` (field-level errors, focuses the first invalid control) and
  `validateEmbedHtml()` (single `<iframe>` from an allowed video host).
- **Polling**: `src/lib/polling.ts` pauses while the tab is hidden and backs off 3 s → 30 s on errors; used for video
  assets and AI jobs (`GET /v1/admin/ai/jobs/{id}`, typed locally until the client is regenerated).
