/**
 * Typed client for katha-api, shared by web, admin and mobile.
 * Types come from ./schema.d.ts, generated from the API's OpenAPI document (`pnpm api:client`).
 */
import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";

export type { paths, components } from "./schema";

export type TokenStore = {
  getAccessToken(): Promise<string | null> | string | null;
  refresh?(): Promise<string | null>;
};

export type ClientOptions = {
  baseUrl: string;
  platform: "web" | "android" | "ios";
  tokens?: TokenStore;
  fetch?: typeof fetch;
};

/**
 * Rebuilds a response as a real `Response` when it is not already one.
 *
 * openapi-fetch validates anything `onResponse` hands back with `instanceof Response` and throws otherwise.
 * Expo replaces the global `fetch` with its own implementation, which resolves an `expo/fetch` `FetchResponse`
 * that does not extend the global `Response`, so on mobile that check rejected every response the middleware
 * returned and turned each API call into a thrown error — after the server had already answered 200. Nothing
 * on the device could load: no config, no rails, no session. Web was unaffected, because a browser's `fetch`
 * returns the real thing, which is why only a device could show this.
 *
 * The body is read as text because every endpoint here is JSON. A status that must not carry one keeps a null
 * body, since the `Response` constructor rejects a body on 204, 205 and 304.
 */
async function asResponse(res: Response): Promise<Response> {
  if (res instanceof Response) return res;

  // TypeScript treats the line above as exhaustive, because the value is declared a `Response`. That
  // declaration is exactly what runtime disagrees with, so read the fields through a structural type.
  const alien = res as unknown as {
    status: number;
    statusText: string;
    headers: Headers;
    text(): Promise<string>;
  };

  const headers = new Headers();
  try {
    alien.headers.forEach((value, key) => headers.set(key, value));
  } catch {
    // A response whose headers cannot be enumerated still carries a usable status and body.
  }

  const bodyless = alien.status === 204 || alien.status === 205 || alien.status === 304;
  const body = bodyless ? null : await alien.text();
  return new Response(body, { status: alien.status, statusText: alien.statusText, headers });
}

export function createKathaClient(opts: ClientOptions) {
  const client = createClient<paths>({ baseUrl: opts.baseUrl, fetch: opts.fetch });

  // openapi-fetch hands onResponse the same Request it already sent, so its body stream is consumed.
  // Keep a clone per request id so a 401 retry can resend POST/PUT bodies.
  const clones = new Map<string, Request>();

  const auth: Middleware = {
    async onRequest({ request, id }) {
      request.headers.set("X-Katha-Platform", opts.platform);
      const token = await opts.tokens?.getAccessToken();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      if (opts.tokens?.refresh && request.method !== "GET" && request.method !== "HEAD") {
        clones.set(id, request.clone());
      }
      return request;
    },
    async onResponse({ request, response, id }) {
      const clone = clones.get(id);
      clones.delete(id);
      // Returning nothing means "leave the response alone". Returning the one we were given would put it
      // through openapi-fetch's `instanceof Response` check for no reason, which is a check Expo's fetch
      // cannot pass. Only the retry below actually replaces the response.
      if (response.status !== 401 || !opts.tokens?.refresh) return;
      const path = new URL(request.url).pathname;
      if (path.endsWith("/v1/auth/exchange") || path.endsWith("/v1/auth/refresh")) return; // not expiry
      const source = clone ?? (request.method === "GET" || request.method === "HEAD" ? request : null);
      if (!source) return;
      const fresh = await opts.tokens.refresh();
      if (!fresh) return;
      const retry = new Request(source, { headers: new Headers(source.headers) });
      retry.headers.set("Authorization", `Bearer ${fresh}`);
      return asResponse(await (opts.fetch ?? fetch)(retry));
    },
    onError({ id }) {
      clones.delete(id);
    },
  };
  client.use(auth);
  return client;
}

export type KathaClient = ReturnType<typeof createKathaClient>;
