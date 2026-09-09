/**
 * Tiny stand-in for the Katha API, just enough for the web smoke tests.
 *
 *   node e2e/mock-api.mjs [--port 8787]
 *
 * It serves the handful of endpoints the pages under test call, records every request at `/__requests`
 * (used to assert that beacons and playback grants were sent), and answers CORS preflights.
 * It is NOT a contract test: shapes here mirror `packages/api-client/openapi.json` by hand.
 */

import { createServer } from "node:http";

const port = Number(process.argv[process.argv.indexOf("--port") + 1]) || Number(process.env.MOCK_API_PORT) || 8787;

const SERIES_ID = "11111111-1111-4111-8111-111111111111";
const EPISODES = [
  { id: "22222222-2222-4222-8222-222222222201", number: 1, title: "The offer", thumbnail_url: null, duration_sec: 90, is_free: true, price: 0, accessible: true, unlocked: false },
  { id: "22222222-2222-4222-8222-222222222202", number: 2, title: "The debt", thumbnail_url: null, duration_sec: 95, is_free: false, price: 30, accessible: false, unlocked: false },
  { id: "22222222-2222-4222-8222-222222222203", number: 3, title: "The heir", thumbnail_url: null, duration_sec: 88, is_free: false, price: 30, accessible: false, unlocked: false },
];

const CATEGORIES = [
  { id: "33333333-3333-4333-8333-333333333331", slug: "romance", name: "Romance" },
  { id: "33333333-3333-4333-8333-333333333332", slug: "revenge", name: "Revenge" },
];

const CARD = {
  id: SERIES_ID,
  slug: "midnight-heiress",
  title: "Midnight Heiress",
  synopsis: "A disowned heiress buys back her family name one night at a time.",
  cover_url: null,
  banner_url: null,
  is_featured: true,
  is_premium: true,
  free_episodes: 1,
  episode_count: EPISODES.length,
  view_count: 128_400,
  like_count: 9_120,
  categories: CATEGORIES.slice(0, 1),
  released_at: "2026-01-04T00:00:00Z",
  first_episode_id: EPISODES[0].id,
  progress: null,
};

const SECOND_CARD = { ...CARD, id: "11111111-1111-4111-8111-111111111112", slug: "paper-crown", title: "Paper Crown", is_featured: false, categories: CATEGORIES.slice(1), first_episode_id: EPISODES[0].id };

const DETAIL = {
  ...CARD,
  seo_title: "Midnight Heiress — Katha",
  meta_description: "A disowned heiress buys back her family name.",
  episodes: EPISODES,
  is_favorite: false,
  is_liked: false,
  continue_episode_number: null,
  similar: [SECOND_CARD],
};

const PACKS = [
  { id: "44444444-4444-4444-8444-444444444441", name: "Starter", kind: "coins", coins: 100, bonus_coins: 0, duration_days: null, badge: null, description: "Enough for three episodes.", price: { amount: 99, currency: "INR" } },
  { id: "44444444-4444-4444-8444-444444444442", name: "Binge", kind: "coins", coins: 600, bonus_coins: 120, duration_days: null, badge: "Best value", description: null, price: { amount: 499, currency: "INR" } },
];

const OFFERS = [
  {
    id: "55555555-5555-4555-8555-555555555551",
    title: "First purchase bonus",
    kind: "first_purchase",
    pack_id: PACKS[1].id,
    discount_pct: 20,
    ends_at: new Date(Date.now() + 3 * 3600_000).toISOString(),
  },
];

const USER = {
  id: "66666666-6666-4666-8666-666666666661",
  public_id: "kat-1001",
  display_name: "Test Viewer",
  email: "viewer@example.com",
  phone: null,
  avatar_url: null,
  locale: "en",
  coin_balance: 120,
  is_vip: false,
  vip_ends_at: null,
  referral_code: "KAT1001",
  age_confirmed_at: null,
  created_at: "2026-01-01T00:00:00Z",
};

/** Every request the browser made, for assertions from the specs. */
const requests = [];

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization,content-type,x-katha-platform,x-katha-country",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function error(res, status, code, message) {
  json(res, status, { detail: { code, message } });
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch {
        resolve(null);
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const path = url.pathname;
  const method = req.method ?? "GET";
  const authed = (req.headers.authorization ?? "").startsWith("Bearer ");

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization,content-type,x-katha-platform,x-katha-country",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Max-Age": "600",
    });
    res.end();
    return;
  }

  const body = method === "GET" ? null : await readBody(req);
  requests.push({ method, path, query: Object.fromEntries(url.searchParams), body, authed, at: Date.now() });

  // Test helpers
  if (path === "/__requests") return json(res, 200, requests);
  if (path === "/__reset") {
    requests.length = 0;
    return json(res, 200, { ok: true });
  }
  if (path === "/health") return json(res, 200, { status: "ok" });

  if (path === "/v1/languages") {
    return json(res, 200, [
      { code: "en", name: "English", native_name: "English", rtl: false },
      { code: "hi", name: "Hindi", native_name: "हिन्दी", rtl: false },
    ]);
  }
  if (path.startsWith("/v1/translations/")) return json(res, 200, { lang: path.split("/").pop(), messages: {} });
  if (path === "/v1/pages") return json(res, 200, [{ slug: "terms", title: "Terms" }]);
  if (path === "/v1/pages/terms") {
    return json(res, 200, { slug: "terms", title: "Terms", body_html: "<p>Terms</p>", updated_at: "2026-01-01T00:00:00Z" });
  }
  if (path === "/v1/config") {
    return json(res, 200, {
      site: { name: "Katha", captcha_site_key: null },
      auth: { email: true, google: false, phone: false },
      economy: { currency: "INR" },
      flags: { rewarded_ads: false },
      payments: { gateways: ["stripe"] },
      firebase: null,
      experiments: {},
    });
  }
  if (path === "/v1/categories") return json(res, 200, CATEGORIES);

  if (path === "/v1/home") {
    return json(res, 200, {
      rails: [
        { key: "featured", title: "Featured", items: [CARD] },
        { key: "top_picks", title: "Top Picks", items: [CARD, SECOND_CARD] },
        { key: "newest", title: "New Releases", items: [SECOND_CARD] },
        ...(authed ? [{ key: "for_you", title: "For You", items: [SECOND_CARD] }] : []),
      ],
    });
  }

  if (path === "/v1/shorts") {
    // One entry per episode, flattened across series exactly as the real feed does: the first episode of
    // each series carries `starts_series`, which is what the feed uses to decide where a series begins.
    const shorts = [CARD, SECOND_CARD].flatMap((series) =>
      EPISODES.map((episode) => ({
        episode_id: episode.id,
        episode_number: episode.number,
        episode_title: episode.title,
        thumbnail_url: episode.thumbnail_url,
        duration_sec: episode.duration_sec,
        is_free: episode.is_free,
        price: episode.price,
        accessible: episode.accessible,
        series_id: series.id,
        slug: series.slug,
        title: series.title,
        synopsis: series.synopsis,
        cover_url: series.cover_url,
        categories: series.categories,
        episode_count: series.episode_count,
        free_episodes: series.free_episodes,
        content_rating: "U",
        is_adult: false,
        is_favorite: false,
        is_liked: false,
        starts_series: episode.number === 1,
      })),
    );
    return json(res, 200, { items: shorts, next_cursor: null });
  }

  if (path === "/v1/series") {
    const category = url.searchParams.get("category");
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const offset = Number(url.searchParams.get("offset") ?? 0);
    let items = [CARD, SECOND_CARD];
    if (category) items = items.filter((s) => s.categories.some((c) => c.slug === category));
    if (q) items = items.filter((s) => s.title.toLowerCase().includes(q));
    return json(res, 200, offset > 0 ? [] : items);
  }

  if (path.startsWith("/v1/series/")) {
    const [, , , idOrSlug, action] = path.split("/");
    if (action === "view" || action === "like" || action === "favorite") {
      return json(res, 200, action === "view" ? { ok: true } : { active: true, count: 9_121 });
    }
    if (idOrSlug === DETAIL.slug || idOrSlug === DETAIL.id) return json(res, 200, DETAIL);
    if (idOrSlug === SECOND_CARD.slug) return json(res, 200, { ...DETAIL, ...SECOND_CARD, episodes: EPISODES, similar: [] });
    return error(res, 404, "not_found", "Series not found");
  }

  if (path.startsWith("/v1/episodes/") && path.endsWith("/play") && method === "POST") {
    const episodeId = path.split("/")[3];
    const episode = EPISODES.find((e) => e.id === episodeId);
    if (!episode) return error(res, 404, "not_found", "Episode not found");
    if (!episode.is_free && !authed) return error(res, 401, "unauthorized", "Sign in to watch this episode");
    if (!episode.is_free) return error(res, 403, "episode_locked", "Unlock this episode first");
    return json(res, 200, {
      episode_id: episode.id,
      hls_url: `http://localhost:${port}/media/${episode.id}/master.m3u8`,
      embed_html: null,
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      resume_position_sec: 0,
      next_episode_id: EPISODES[1].id,
      subtitles: [],
    });
  }

  // A syntactically valid (but empty) playlist: the player mounts, nothing decodes.
  if (path.startsWith("/media/") && path.endsWith(".m3u8")) {
    res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Access-Control-Allow-Origin": "*" });
    res.end("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-ENDLIST\n");
    return;
  }

  if (path === "/v1/auth/me") {
    if (!authed) return error(res, 401, "unauthorized", "Sign in to continue");
    if (method === "PATCH") return json(res, 200, { ...USER, age_confirmed_at: new Date().toISOString() });
    return json(res, 200, USER);
  }

  if (path === "/v1/wallet") {
    if (!authed) return error(res, 401, "unauthorized", "Sign in to continue");
    return json(res, 200, { coin_balance: USER.coin_balance, is_vip: false, vip_ends_at: null });
  }
  if (path === "/v1/wallet/packs") return json(res, 200, PACKS);
  if (path === "/v1/wallet/offers") {
    if (!authed) return error(res, 401, "unauthorized", "Sign in to continue");
    return json(res, 200, OFFERS);
  }
  if (path === "/v1/purchases/checkout" && method === "POST") {
    if (!authed) return error(res, 401, "unauthorized", "Sign in to continue");
    if (body?.coupon_code && body.coupon_code !== "KATHA20") return error(res, 404, "coupon_invalid", "Coupon not found");
    const pack = PACKS.find((p) => p.id === body?.pack_id) ?? PACKS[0];
    const discount = body?.coupon_code || body?.offer_id ? 20 : null;
    const amount = discount ? Math.round(pack.price.amount * 0.8 * 100) / 100 : pack.price.amount;
    return json(res, 200, {
      purchase_id: "77777777-7777-4777-8777-777777777771",
      gateway: "stripe",
      checkout_url: "https://checkout.stripe.com/c/pay/test",
      currency: "INR",
      amount,
      discount_pct: discount,
    });
  }

  if (path === "/v1/sitemap") {
    return json(res, 200, {
      series: [
        { slug: CARD.slug, updated_at: "2026-02-01T10:00:00Z", langs: ["en", "hi"] },
        { slug: SECOND_CARD.slug, updated_at: "2026-02-02T10:00:00Z", langs: ["en"] },
      ],
      pages: ["terms"],
    });
  }

  if (path === "/v1/events" && method === "POST") return json(res, 200, { ok: true });

  return error(res, 404, "not_found", `No mock for ${method} ${path}`);
});

server.listen(port, () => {
  process.stdout.write(`mock-api listening on http://localhost:${port}\n`);
});
