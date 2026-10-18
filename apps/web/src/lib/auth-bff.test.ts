import { afterEach, describe, expect, it, vi } from "vitest";
import { authBff } from "./auth-bff";

const body = { firebase_id_token: "t", device_id: "d" } as never;

afterEach(() => vi.unstubAllGlobals());

function stubFetch(res: Response) {
  const f = vi.fn().mockResolvedValue(res);
  vi.stubGlobal("fetch", f);
  return f;
}

describe("authBff", () => {
  it("exchange posts JSON same-origin and returns parsed data", async () => {
    const f = stubFetch(new Response(JSON.stringify({ access_token: "a", expires_in: 900, is_new_user: true }), { status: 200 }));
    const r = await authBff.exchange(body);
    expect(r.data).toEqual({ access_token: "a", expires_in: 900, is_new_user: true });
    expect(f).toHaveBeenCalledWith("/api/auth/exchange", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  });

  it("returns the parsed error body for a failed response", async () => {
    stubFetch(new Response(JSON.stringify({ detail: { code: "x", message: "m" } }), { status: 400 }));
    const r = await authBff.exchange(body);
    expect(r.data).toBeUndefined();
    expect(r.error).toEqual({ detail: { code: "x", message: "m" } });
  });

  it("synthesises an error when the failure body is empty or not JSON", async () => {
    stubFetch(new Response("", { status: 502 }));
    expect((await authBff.exchange(body)).error).toEqual({ detail: "Request failed (502)" });
    stubFetch(new Response("<html>", { status: 500 }));
    expect((await authBff.exchange(body)).error).toEqual({ detail: "Request failed (500)" });
  });

  it("tolerates an empty or invalid success body", async () => {
    stubFetch(new Response("", { status: 200 }));
    expect((await authBff.exchange(body)).data).toBeUndefined();
    stubFetch(new Response("nope", { status: 200 }));
    expect((await authBff.exchange(body)).data).toBeUndefined();
  });

  it("refresh returns the raw response", async () => {
    const res = new Response("{}", { status: 401 });
    const f = stubFetch(res);
    expect(await authBff.refresh()).toBe(res);
    expect(f).toHaveBeenCalledWith("/api/auth/refresh", expect.objectContaining({ method: "POST", body: "{}" }));
  });

  it("logout sends the bearer token only when there is one", async () => {
    const f = vi.fn().mockImplementation(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal("fetch", f);
    await authBff.logout("tok");
    expect(f.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer tok" });
    await authBff.logout(null);
    expect(f.mock.calls[1][1].headers).toEqual({ "Content-Type": "application/json" });
  });
});
