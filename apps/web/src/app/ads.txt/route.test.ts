import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("ads.txt", () => {
  it("serves an empty file when unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADS_TXT", "");
    const res = GET();
    expect(await res.text()).toBe("");
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
  });
  it("expands literal \\n and ends with a newline", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADS_TXT", "a.com, 1, DIRECT\\nb.com, 2, RESELLER ");
    const res = GET();
    expect(await res.text()).toBe("a.com, 1, DIRECT\nb.com, 2, RESELLER\n");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });
  it("treats an undefined variable as empty", async () => {
    delete process.env.NEXT_PUBLIC_ADS_TXT;
    expect(await GET().text()).toBe("");
  });
});
