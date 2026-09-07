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
      if (response.status !== 401 || !opts.tokens?.refresh) return response;
      const path = new URL(request.url).pathname;
      if (path.endsWith("/v1/auth/exchange") || path.endsWith("/v1/auth/refresh")) return response; // not expiry
      const source = clone ?? (request.method === "GET" || request.method === "HEAD" ? request : null);
      if (!source) return response;
      const fresh = await opts.tokens.refresh();
      if (!fresh) return response;
      const retry = new Request(source, { headers: new Headers(source.headers) });
      retry.headers.set("Authorization", `Bearer ${fresh}`);
      return (opts.fetch ?? fetch)(retry);
    },
    onError({ id }) {
      clones.delete(id);
    },
  };
  client.use(auth);
  return client;
}

export type KathaClient = ReturnType<typeof createKathaClient>;
