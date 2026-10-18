import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("indexnow key file", () => {
  it("404s without a key", async () => {
    delete process.env.NEXT_PUBLIC_INDEXNOW_KEY;
    const res = GET();
    expect(res.status).toBe(404);
  });
  it("404s for a blank key", () => {
    vi.stubEnv("NEXT_PUBLIC_INDEXNOW_KEY", "   ");
    expect(GET().status).toBe(404);
  });
  it("serves the trimmed key", async () => {
    vi.stubEnv("NEXT_PUBLIC_INDEXNOW_KEY", " abc123 ");
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("abc123");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
  });
});
