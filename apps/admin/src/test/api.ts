/**
 * Boundary mock for the network. `vitest.setup.ts` replaces `globalThis.fetch` with `fetchStub` before any app
 * module loads (openapi-fetch captures `fetch` when the client is created), so the real `api` client, its
 * middleware and `call()` all run; only the HTTP round trip is faked.
 *
 *   mockApi.get("/v1/admin/users", { items: [], total: 0 });
 *   mockApi.post("/v1/admin/users/*\/ban", (c) => ({ ...c.body }));   // function replies see the request
 *   mockApi.get("/v1/x", fail(409, "conflict"));
 *   expect(mockApi.callsTo("POST", "/v1/admin/users/u1/ban")[0].body).toEqual({...});
 *
 * Later registrations win over earlier ones. A path pattern may use `*` for one segment. Unmatched requests
 * answer 404 `{detail: "unmocked: METHOD /path"}` and are recorded in `mockApi.unmatched`.
 */
export type Call = {
  method: string;
  path: string;
  url: URL;
  query: Record<string, string>;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: Headers;
  request: Request;
};
type ReplyFn = (c: Call) => unknown | Response | Promise<unknown | Response>;
type Reply = ReplyFn | Response | Record<string, unknown> | unknown[] | string | number | boolean | null | undefined;
type Route = { method: string; matcher: string | RegExp; reply: Reply };

/** A canned error response in the API's `{detail}` shape. `detail` may be a string, an object or an array. */
export function fail(status: number, detail: unknown = "error"): Response {
  return Response.json({ detail }, { status });
}
/** A response with an explicit status (e.g. `respond(204)` or `respond(201, body)`). */
export function respond(status: number, body?: unknown): Response {
  if (status === 204 || body === undefined) return new Response(null, { status });
  return Response.json(body, { status });
}

let routes: Route[] = [];
export const calls: Call[] = [];
export const unmatched: Call[] = [];

function matches(r: Route, c: Call): boolean {
  if (r.method !== "*" && r.method !== c.method) return false;
  const target = typeof r.matcher === "string" && r.matcher.includes("://") ? c.url.origin + c.path : c.path;
  if (r.matcher instanceof RegExp) return r.matcher.test(target);
  if (!r.matcher.includes("*")) return r.matcher === target;
  const re = new RegExp("^" + r.matcher.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]+") + "$");
  return re.test(target);
}

export async function fetchStub(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : new Request(new URL(String(input), "http://localhost"), init);
  const url = new URL(request.url);
  let body: unknown = undefined;
  const text = await request.clone().text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  const call: Call = {
    method: request.method.toUpperCase(),
    path: url.pathname,
    url,
    query: Object.fromEntries(url.searchParams),
    body,
    headers: request.headers,
    request,
  };
  calls.push(call);
  for (let i = routes.length - 1; i >= 0; i--) {
    if (!matches(routes[i], call)) continue;
    const reply = routes[i].reply;
    const out = typeof reply === "function" ? await (reply as ReplyFn)(call) : reply;
    if (out instanceof Response) return out;
    return out === undefined ? new Response(null, { status: 204 }) : Response.json(out);
  }
  unmatched.push(call);
  return Response.json({ detail: `unmocked: ${call.method} ${call.path}` }, { status: 404 });
}

function on(method: string) {
  return (matcher: string | RegExp, reply: Reply) => {
    routes.push({ method, matcher, reply });
  };
}

export const mockApi = {
  on: (method: string, matcher: string | RegExp, reply: Reply) => on(method.toUpperCase())(matcher, reply),
  get: on("GET"),
  post: on("POST"),
  put: on("PUT"),
  patch: on("PATCH"),
  delete: on("DELETE"),
  any: on("*"),
  calls,
  unmatched,
  callsTo(method: string, matcher?: string | RegExp): Call[] {
    return calls.filter((c) => c.method === method.toUpperCase() && (matcher === undefined || matches({ method: "*", matcher, reply: null }, c)));
  },
  reset() {
    routes = [];
    calls.length = 0;
    unmatched.length = 0;
  },
};
