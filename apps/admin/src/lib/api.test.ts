import { describe, expect, it } from "vitest";
import { mockApi, fail } from "@/test/api";
import { ApiError, api, call, errorMessage } from "./api";
import { TOKEN_KEY, setToken } from "./token";

describe("errorMessage", () => {
  it("uses ApiError and string detail", () => {
    expect(errorMessage(new ApiError("boom", 500))).toBe("boom");
    expect(errorMessage({ detail: "plain" })).toBe("plain");
  });
  it("flattens validation arrays, dropping the body prefix", () => {
    expect(errorMessage({ detail: [{ loc: ["body", "a", 0], msg: "bad" }, { msg: "top" }, { loc: ["body"] }] })).toBe(
      "a.0: bad; top; invalid",
    );
  });
  it("reads detail.message", () => {
    expect(errorMessage({ detail: { message: "nested", code: "x" } })).toBe("nested");
  });
  it("recognises network failures and generic errors", () => {
    expect(errorMessage(new TypeError("Failed to fetch"))).toMatch(/Cannot reach the API/);
    expect(errorMessage(new Error("other"))).toBe("other");
    expect(errorMessage({ detail: 5 })).toBe("Something went wrong");
  });
  it("falls back to the response status", () => {
    expect(errorMessage(undefined, new Response(null, { status: 502, statusText: "Bad Gateway" }))).toBe("502 Bad Gateway");
    expect(errorMessage(null, new Response(null, { status: 500 }))).toBe("500 error");
    expect(errorMessage(null)).toBe("Something went wrong");
  });
});

describe("call", () => {
  it("returns data and sends the bearer token and platform header", async () => {
    setToken("tok", 60);
    mockApi.get("/v1/admin/auth/me", { id: "1" });
    const data = await call(api.GET("/v1/admin/auth/me"));
    expect(data).toEqual({ id: "1" });
    const [c] = mockApi.callsTo("GET", "/v1/admin/auth/me");
    expect(c.headers.get("authorization")).toBe("Bearer tok");
    expect(c.headers.get("x-katha-platform")).toBe("web");
  });
  it("throws ApiError with status and code from the body", async () => {
    mockApi.get("/v1/admin/auth/me", fail(409, { code: "dup", message: "Already there" }));
    await expect(call(api.GET("/v1/admin/auth/me"))).rejects.toMatchObject({ status: 409, code: "dup", message: "Already there" });
  });
  it("uses validation_error for array details and error otherwise", async () => {
    mockApi.get("/v1/admin/auth/me", fail(422, [{ loc: ["body", "x"], msg: "no" }]));
    await expect(call(api.GET("/v1/admin/auth/me"))).rejects.toMatchObject({ code: "validation_error", message: "x: no" });
    mockApi.get("/v1/admin/auth/me", fail(400, "text"));
    await expect(call(api.GET("/v1/admin/auth/me"))).rejects.toMatchObject({ code: "error" });
  });
  it("normalises thrown network errors", async () => {
    await expect(call(Promise.reject(new TypeError("Failed to fetch")))).rejects.toMatchObject({ status: 0, code: "network" });
  });
  it("treats a non-ok response without error as failure", async () => {
    await expect(call(Promise.resolve({ response: new Response(null, { status: 500 }) }))).rejects.toMatchObject({ status: 500 });
  });
});

describe("401 handling", () => {
  function stubLocation(path: string) {
    const loc = { pathname: path.split("?")[0], search: path.includes("?") ? "?" + path.split("?")[1] : "", origin: "http://localhost", href: "" };
    Object.defineProperty(window, "location", { value: loc, configurable: true, writable: true });
    return loc;
  }
  async function hit(body: unknown, path = "/users?x=1") {
    setToken("tok", 60);
    const loc = stubLocation(path);
    mockApi.get("/v1/admin/auth/me", typeof body === "string" ? new Response(body, { status: 401 }) : fail(401, body));
    await call(api.GET("/v1/admin/auth/me")).catch(() => {});
    return loc;
  }
  it("sends the admin to /login with next and reason=expired", async () => {
    const loc = await hit({ code: "unauthorized", message: "Invalid or expired token" });
    const u = new URL(loc.href);
    expect(u.pathname).toBe("/login");
    expect(u.searchParams.get("next")).toBe("/users?x=1");
    expect(u.searchParams.get("reason")).toBe("expired");
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
  it("reports revoked sessions", async () => {
    const loc = await hit({ code: "session_revoked", message: "gone" });
    expect(new URL(loc.href).searchParams.get("reason")).toBe("revoked");
  });
  it("treats a non-JSON or unstructured 401 as expiry", async () => {
    expect(new URL((await hit("not json")).href).searchParams.get("reason")).toBe("expired");
    expect(new URL((await hit("plain")).href).searchParams.get("reason")).toBe("expired");
  });
  it("leaves a bad-credentials 401 for the form", async () => {
    const loc = await hit({ code: "unauthorized", message: "Invalid credentials" });
    expect(loc.href).toBe("");
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe("tok");
  });
  it("does not redirect when already on /login", async () => {
    const loc = await hit({ code: "session_revoked" }, "/login");
    expect(loc.href).toBe("");
  });
});
