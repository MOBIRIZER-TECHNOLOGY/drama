import { describe, expect, it } from "vitest";
import { call, isApiError, toApiError } from "./errors";

const res = (status: number, ok = status < 400) => ({ status, ok }) as Response;

describe("toApiError", () => {
  it("reads {detail:{code,message}}", () => {
    expect(toApiError({ detail: { code: "insufficient_coins", message: "Not enough" } }, res(402))).toEqual({
      status: 402,
      code: "insufficient_coins",
      message: "Not enough",
    });
  });
  it("defaults code and message for an object detail missing them", () => {
    expect(toApiError({ detail: {} }, res(400))).toEqual({ status: 400, code: "error", message: "Something went wrong" });
  });
  it("reads validation arrays", () => {
    expect(toApiError({ detail: [{ msg: "bad email" }] }, res(422))).toEqual({ status: 422, code: "validation_error", message: "bad email" });
    expect(toApiError({ detail: [] }, res(422)).message).toBe("Invalid input");
    expect(toApiError({ detail: ["x"] }, res(422)).message).toBe("Invalid input");
  });
  it("reads string detail", () => {
    expect(toApiError({ detail: "nope" }, res(400))).toEqual({ status: 400, code: "error", message: "nope" });
  });
  it("falls through unknown detail shapes to status handling", () => {
    expect(toApiError({ detail: 5 }, res(404)).code).toBe("not_found");
  });
  it("maps network-ish errors to network_error", () => {
    for (const name of ["TypeError", "AbortError", "TimeoutError"]) {
      const e = new Error("x");
      e.name = name;
      expect(toApiError(e)).toMatchObject({ status: 0, code: "network_error" });
    }
  });
  it("keeps other Error messages", () => {
    expect(toApiError(new Error("boom"))).toEqual({ status: 0, code: "error", message: "boom" });
  });
  it("maps bare statuses", () => {
    expect(toApiError(undefined, res(401))).toMatchObject({ code: "unauthorized" });
    expect(toApiError(undefined, res(403))).toMatchObject({ code: "forbidden" });
    expect(toApiError(undefined, res(404))).toMatchObject({ code: "not_found" });
    expect(toApiError(undefined, res(500))).toEqual({ status: 500, code: "error", message: "Request failed (500)" });
    expect(toApiError(undefined)).toEqual({ status: 0, code: "error", message: "Something went wrong" });
  });
});

describe("isApiError", () => {
  it("recognises the shape", () => {
    expect(isApiError({ status: 1, code: "x", message: "m" })).toBe(true);
    expect(isApiError(null)).toBe(false);
    expect(isApiError("x")).toBe(false);
    expect(isApiError({ code: 1, message: "m" })).toBe(false);
    expect(isApiError({ code: "x" })).toBe(false);
  });
});

describe("call", () => {
  it("returns data on success", async () => {
    expect(await call(async () => ({ data: 7, response: res(200) }))).toEqual({ data: 7, error: null });
  });
  it("returns the normalised error when error is set", async () => {
    const r = await call(async () => ({ error: { detail: "bad" }, response: res(400) }));
    expect(r).toEqual({ data: null, error: { status: 400, code: "error", message: "bad" } });
  });
  it("treats a non-ok response without error as failure", async () => {
    const r = await call(async () => ({ response: res(500) }));
    expect(r.error?.status).toBe(500);
  });
  it("catches thrown errors", async () => {
    const r = await call(async () => {
      throw new TypeError("fetch failed");
    });
    expect(r.error?.code).toBe("network_error");
  });
});
