import { describe, expect, it, vi } from "vitest";

const create = vi.fn((opts: unknown) => ({ opts }));
vi.mock("@katha/api-client", () => ({ createKathaClient: (o: unknown) => create(o) }));

describe("clientApi", () => {
  it("wires the token store into the browser client", async () => {
    const { clientApi } = await import("./client-api");
    const { tokenStore } = await import("./token-store");
    const { API_URL } = await import("./api");
    const calls = create.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ baseUrl: API_URL, platform: "web", tokens: tokenStore });
    expect(clientApi).toBeDefined();
  });
});
