import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as exchange } from "./exchange/route";
import { POST as logout } from "./logout/route";
import { POST as refresh } from "./refresh/route";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function req(path: string, body: unknown, headers: Record<string, string> = {}, cookie?: string) {
  const h: Record<string, string> = { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers };
  if (cookie) h.cookie = `katha_refresh=${cookie}`;
  return new NextRequest(`http://localhost:3000/api/auth/${path}`, {
    method: "POST",
    headers: h,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const pair = { access_token: "acc", refresh_token: "ref", expires_in: 900, is_new_user: true };

describe("POST /api/auth/exchange", () => {
  it("refuses cross-site requests before doing anything", async () => {
    const r = await exchange(req("exchange", {}, { "sec-fetch-site": "cross-site" }));
    expect(r.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects invalid JSON and missing token", async () => {
    expect((await exchange(req("exchange", "{bad"))).status).toBe(400);
    expect((await exchange(req("exchange", "null"))).status).toBe(400);
    expect((await exchange(req("exchange", { firebase_id_token: 5 }))).status).toBe(400);
  });
  it("forces platform=web, stores the refresh token in a cookie and returns only the access token", async () => {
    fetchMock.mockResolvedValue(ok(pair));
    const r = await exchange(req("exchange", { firebase_id_token: "fb", platform: "ios" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ firebase_id_token: "fb", platform: "web" });
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8000/v1/auth/exchange");
    const body = await r.json();
    expect(body).toEqual({ access_token: "acc", expires_in: 900, is_new_user: true });
    expect(JSON.stringify(body)).not.toContain("ref");
    expect(r.headers.get("set-cookie")).toContain("katha_refresh=ref");
  });
  it("502s when the API is down and passes upstream errors through", async () => {
    fetchMock.mockRejectedValueOnce(new Error("x"));
    expect((await exchange(req("exchange", { firebase_id_token: "fb" }))).status).toBe(502);
    fetchMock.mockResolvedValueOnce(ok({ detail: { code: "bad", message: "m" } }, 400));
    const r = await exchange(req("exchange", { firebase_id_token: "fb" }));
    expect(r.status).toBe(400);
    expect((await r.json()).detail.code).toBe("bad");
    expect(r.headers.get("set-cookie")).toBeNull();
  });
});

describe("POST /api/auth/refresh", () => {
  it("refuses cross-site", async () => {
    expect((await refresh(req("refresh", {}, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
  });
  it("401s and clears the cookie with no session", async () => {
    const r = await refresh(req("refresh", {}));
    expect(r.status).toBe(401);
    expect(r.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rotates the token", async () => {
    fetchMock.mockResolvedValue(ok({ ...pair, refresh_token: "ref2" }));
    const r = await refresh(req("refresh", {}, {}, "ref"));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refresh_token: "ref" });
    expect(r.headers.get("set-cookie")).toContain("katha_refresh=ref2");
    expect((await r.json()).access_token).toBe("acc");
  });
  it.each([401, 403])("clears the cookie when the API says %s", async (status) => {
    fetchMock.mockResolvedValue(ok({ detail: "gone" }, status));
    const r = await refresh(req("refresh", {}, {}, "ref"));
    expect(r.status).toBe(status);
    expect(r.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });
  it("keeps the cookie on other upstream errors and when unreachable", async () => {
    fetchMock.mockResolvedValueOnce(ok({ detail: "boom" }, 500));
    const r = await refresh(req("refresh", {}, {}, "ref"));
    expect(r.status).toBe(500);
    expect(r.headers.get("set-cookie")).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("x"));
    expect((await refresh(req("refresh", {}, {}, "ref"))).status).toBe(502);
  });
});

describe("POST /api/auth/logout", () => {
  const calls = () => fetchMock.mock.calls.map((c) => [c[0].replace("http://localhost:8000", ""), c[1].headers.get("Authorization")]);
  it("refuses cross-site", async () => {
    expect((await logout(req("logout", {}, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
  });
  it("revokes with the page's bearer and always clears the cookie", async () => {
    fetchMock.mockResolvedValue(ok({ ok: true }));
    const r = await logout(req("logout", {}, { authorization: "Bearer t" }, "ref"));
    expect(calls()).toEqual([["/v1/auth/logout", "Bearer t"]]);
    expect(await r.json()).toEqual({ ok: true });
    expect(r.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });
  it("trades the cookie for a fresh token when the bearer is expired (401)", async () => {
    fetchMock
      .mockResolvedValueOnce(ok({}, 401))
      .mockResolvedValueOnce(ok({ ...pair, access_token: "fresh" }))
      .mockResolvedValueOnce(ok({ ok: true }));
    await logout(req("logout", {}, { authorization: "Bearer old" }, "ref"));
    expect(calls()).toEqual([
      ["/v1/auth/logout", "Bearer old"],
      ["/v1/auth/refresh", null],
      ["/v1/auth/logout", "Bearer fresh"],
    ]);
  });
  it("uses only the cookie when there is no bearer, and tolerates refresh failure", async () => {
    fetchMock.mockResolvedValueOnce(ok({ detail: "x" }, 401));
    const r = await logout(req("logout", {}, {}, "ref"));
    expect(calls()).toEqual([["/v1/auth/refresh", null]]);
    expect(r.status).toBe(200);
  });
  it("does nothing upstream with neither bearer nor cookie, and survives an unreachable API", async () => {
    const r = await logout(req("logout", {}));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.status).toBe(200);
    fetchMock.mockRejectedValue(new Error("down"));
    expect((await logout(req("logout", {}, { authorization: "Bearer t" }, "ref"))).status).toBe(200);
  });
});
