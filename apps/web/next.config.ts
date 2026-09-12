import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

const FALLBACK_LANGS = ["en", "hi"];
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const LANG_CODE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/** Media/CDN origins (HLS, covers, subtitles, avatars). Comma-separated, e.g. https://cdn.katha.app,http://localhost:9000 */
const MEDIA_ORIGINS = (process.env.NEXT_PUBLIC_MEDIA_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** IndexNow key (letters/digits/dashes only); when set, `/{key}.txt` serves it. */
const INDEXNOW_KEY = (process.env.NEXT_PUBLIC_INDEXNOW_KEY ?? "").trim().match(/^[A-Za-z0-9-]{8,128}$/)?.[0] ?? "";

/** Avatar hosts from the sign-in providers. */
const PROVIDER_IMAGE_HOSTS = ["lh3.googleusercontent.com", "graph.facebook.com"];

/**
 * The language prefixes the proxy routes, resolved once at build/start time so `/hi/...` needs no network
 * call per request (see src/proxy.ts for why the proxy cannot take the live list).
 *
 * Resolution order: an explicit `NEXT_PUBLIC_LANGS` wins, otherwise `GET /v1/languages`. A production build
 * with neither fails outright. It used to fall back to en/hi silently, which meant a build whose API was
 * down shipped a site where every other language's URL was a 404 and nothing in the build log said so.
 * Outside a production build — `next dev`, `next typegen` in CI — the fallback stays, with a warning, so a
 * typecheck does not need a running API. `next typegen` loads the config with the build phase, so it is
 * told apart by the subcommand: it emits route types, not a deployable site, and the list does not matter.
 */
const IS_TYPEGEN = process.argv.includes("typegen");

async function resolveLanguages(phase: string): Promise<string[]> {
  const explicit = (process.env.NEXT_PUBLIC_LANGS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (explicit.length) {
    const bad = explicit.filter((c) => !LANG_CODE.test(c));
    if (bad.length) throw new Error(`NEXT_PUBLIC_LANGS contains invalid language codes: ${bad.join(", ")}`);
    return explicit.includes("en") ? explicit : ["en", ...explicit];
  }

  let failure: string;
  try {
    const res = await fetch(`${API_URL}/v1/languages`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const rows = (await res.json()) as { code?: string }[];
      const codes = rows.map((r) => r.code ?? "").filter((c) => LANG_CODE.test(c));
      if (codes.length) return codes.includes("en") ? codes : ["en", ...codes];
      failure = `${API_URL}/v1/languages returned no languages`;
    } else {
      failure = `${API_URL}/v1/languages answered ${res.status}`;
    }
  } catch (err) {
    failure = `${API_URL}/v1/languages is unreachable (${err instanceof Error ? err.message : String(err)})`;
  }

  if (phase === PHASE_PRODUCTION_BUILD && !IS_TYPEGEN) {
    throw new Error(
      `Cannot resolve the language list for the build: ${failure}. Either start the API before building or ` +
        `set NEXT_PUBLIC_LANGS explicitly (comma-separated codes, e.g. NEXT_PUBLIC_LANGS=en,hi,ta).`,
    );
  }
  console.warn(`[next.config] ${failure}; using ${FALLBACK_LANGS.join(",")} for this ${phase} run.`);
  return FALLBACK_LANGS;
}

function originToPattern(origin: string): { protocol: "http" | "https"; hostname: string; port?: string } | null {
  try {
    const u = new URL(origin);
    return { protocol: u.protocol === "http:" ? "http" : "https", hostname: u.hostname, port: u.port || undefined };
  } catch {
    return null;
  }
}

export default async function config(phase: string): Promise<NextConfig> {
  const langs = await resolveLanguages(phase);
  // Comma-separated hosts allowed to load dev assets, e.g. a phone on the LAN: NEXT_DEV_ALLOWED_ORIGINS=192.168.1.20
  const devOrigins = (process.env.NEXT_DEV_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const remotePatterns = [
    ...MEDIA_ORIGINS.map(originToPattern).filter((p): p is NonNullable<typeof p> => p !== null),
    ...PROVIDER_IMAGE_HOSTS.map((hostname) => ({ protocol: "https" as const, hostname })),
  ];
  return {
    env: { NEXT_PUBLIC_LANGS: langs.join(",") },
    ...(devOrigins.length ? { allowedDevOrigins: devOrigins } : {}),
    images: {
      remotePatterns,
      // Development only, or explicitly opted into with NEXT_PUBLIC_ALLOW_LOCAL_IMAGE_HOSTS=1. Media is
      // served from a machine on the LAN (the emulator and the browser have to reach one hostname between
      // them), and Next blocks private addresses by default to stop the image optimiser being used to probe
      // an internal network. That protection guards against a *user-controlled* hostname resolving
      // somewhere internal; `remotePatterns` above is a small fixed allowlist we set, not user input, so a
      // deployment whose own DNS (or a local /etc/hosts override, for testing) happens to point one of
      // those hostnames at a private IP is not the SSRF this exists to catch — opting in there is safe.
      dangerouslyAllowLocalIP:
        process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_ALLOW_LOCAL_IMAGE_HOSTS === "1",
    },
    // IndexNow verification file: /<key>.txt must return the key. The path is dynamic, and the app root already
    // owns the `[lang]` segment, so it is rewritten onto a fixed route handler instead of a second dynamic segment.
    async rewrites() {
      return INDEXNOW_KEY ? [{ source: `/${INDEXNOW_KEY}.txt`, destination: "/api/indexnow" }] : [];
    },
    // Content-Security-Policy is not here: it carries a per-response nonce, so src/proxy.ts sets it on every
    // page response (src/lib/csp.ts builds it). What remains is the static set.
    async headers() {
      return [
        {
          source: "/(.*)",
          headers: [
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
            { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
            { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
            { key: "X-Frame-Options", value: "DENY" },
          ],
        },
      ];
    },
  };
}
