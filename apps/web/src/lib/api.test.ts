import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@katha/api-client", () => ({ createKathaClient: vi.fn((opts) => ({ opts })) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("api", () => {
  it("falls back to localhost defaults and creates an anonymous web client", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", undefined as unknown as string);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", undefined as unknown as string);
    delete process.env.NEXT_PUBLIC_API_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const mod = await import("./api");
    expect(mod.API_URL).toBe("http://localhost:8000");
    expect(mod.SITE_URL).toBe("http://localhost:3000");
    expect((mod.api as unknown as { opts: unknown }).opts).toEqual({ baseUrl: "http://localhost:8000", platform: "web" });
  });

  it("strips one trailing slash from configured URLs", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com/");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.com/");
    const mod = await import("./api");
    expect(mod.API_URL).toBe("https://api.example.com");
    expect(mod.SITE_URL).toBe("https://example.com");
  });

  it("timeoutSignal aborts after the given time and defaults to the request timeout", async () => {
    const mod = await import("./api");
    const spy = vi.spyOn(AbortSignal, "timeout");
    mod.timeoutSignal();
    mod.timeoutSignal(10);
    expect(spy).toHaveBeenNthCalledWith(1, mod.REQUEST_TIMEOUT_MS);
    expect(spy).toHaveBeenNthCalledWith(2, 10);
  });
});
