import "@/test/components-dom-matchers";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDialogPolyfill } from "@/test/components-dialog";
import { fail, mockApi } from "@/test/api";
import { nav } from "@/test/navigation";
import type { Role } from "@/lib/nav";
import { CommandPalette } from "./command-palette";

beforeAll(installDialogPolyfill);
afterEach(() => vi.useRealTimers());

const input = () => screen.getByLabelText("Search screens, series and users") as HTMLInputElement;
const ctrlK = () => fireEvent.keyDown(document, { key: "k", ctrlKey: true });

function series(id: string, title: string, status = "published") {
  return { id, slug: id, status, original_language: "en", translations: [{ lang: "en", title }] };
}
function user(id: string, over: Record<string, unknown> = {}) {
  return { id, public_id: `P-${id}`, display_name: `Name ${id}`, email: `${id}@x.io`, ...over };
}
function setup(role: Role = "owner") {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<CommandPalette role={role} />);
  return u;
}
async function typeAndSettle(u: ReturnType<typeof userEvent.setup>, text: string) {
  await u.type(input(), text);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

describe("CommandPalette", () => {
  it("is closed until Ctrl/Cmd+K, toggles on repeat, and ignores other keys", () => {
    setup();
    expect(document.querySelector("dialog")!.open).toBe(false);
    fireEvent.keyDown(document, { key: "j", ctrlKey: true });
    fireEvent.keyDown(document, { key: "k" });
    expect(document.querySelector("dialog")!.open).toBe(false);
    ctrlK();
    expect(document.querySelector("dialog")!.open).toBe(true);
    ctrlK();
    expect(document.querySelector("dialog")!.open).toBe(false);
    fireEvent.keyDown(document, { key: "K", metaKey: true });
    expect(document.querySelector("dialog")!.open).toBe(true);
  });

  it("does not open over another modal dialog", () => {
    setup();
    const other = document.createElement("dialog");
    other.setAttribute("open", "");
    document.body.appendChild(other);
    ctrlK();
    expect(document.querySelectorAll("dialog")[0].hasAttribute("open")).toBe(false);
    other.remove();
  });

  it("lists only the routes this role can reach, filters them locally, and makes no request for short queries", async () => {
    const u = setup("support");
    ctrlK();
    const labels = () => screen.getAllByRole("button").filter((b) => b.closest("li")).map((b) => b.querySelector("span")!.textContent);
    expect(labels()).toContain("Users");
    expect(labels()).not.toContain("Audit Log");
    await typeAndSettle(u, "r");
    expect(labels()).toEqual(["Dashboard", "Users", "Moderation", "Reports"]); // NAV order, role-filtered
    expect(labels().every((l) => l!.toLowerCase().includes("r"))).toBe(true);
    expect(mockApi.calls).toHaveLength(0);
  });

  it("shows 'No matches' when nothing fits", async () => {
    const u = setup();
    ctrlK();
    mockApi.get("/v1/admin/series", { items: [] });
    mockApi.get("/v1/admin/users", { items: [] });
    await typeAndSettle(u, "zzzz");
    expect(screen.getByText("No matches")).toBeTruthy();
  });

  it("searches series and users after a debounce and navigates to the picked result", async () => {
    mockApi.get("/v1/admin/series", { items: [series("s1", "Revenge Queen", "review")] });
    mockApi.get("/v1/admin/users", { items: [user("u1"), user("u2", { display_name: "", email: "e@x.io" }), user("u3", { display_name: "", email: null })] });
    const u = setup();
    ctrlK();
    await u.type(input(), "rev");
    expect(mockApi.callsTo("GET", "/v1/admin/series")).toHaveLength(0); // still inside the 220ms debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const sc = mockApi.callsTo("GET", "/v1/admin/series");
    expect(sc).toHaveLength(1);
    expect(sc[0].query).toMatchObject({ q: "rev", limit: "5" });
    expect(mockApi.callsTo("GET", "/v1/admin/users")[0].query).toMatchObject({ q: "rev", limit: "5" });
    expect(screen.getByText("Revenge Queen")).toBeTruthy();
    expect(screen.getByText("review")).toBeTruthy();
    expect(screen.getByText("Name u1")).toBeTruthy();
    expect(screen.getByText("e@x.io")).toBeTruthy();
    expect(screen.getByText("P-u3", { selector: "span.truncate" })).toBeTruthy();

    await u.click(screen.getByText("Revenge Queen"));
    expect(nav.router.push).toEqual(["/dramas/s1"]);
    expect(document.querySelector("dialog")!.open).toBe(false);
  });

  it("user results link to the users screen", async () => {
    mockApi.get("/v1/admin/series", { items: [] });
    mockApi.get("/v1/admin/users", { items: [user("u9")] });
    const u = setup();
    ctrlK();
    await typeAndSettle(u, "name");
    await u.click(screen.getByText("Name u9"));
    expect(nav.router.push).toEqual(["/users?user=u9"]);
  });

  it("does not query users for a role without access to them", async () => {
    mockApi.get("/v1/admin/series", { items: [series("s1", "Alpha")] });
    const u = setup("editor");
    ctrlK();
    await typeAndSettle(u, "alp");
    expect(mockApi.callsTo("GET", "/v1/admin/users")).toHaveLength(0);
    expect(screen.getByText("Alpha")).toBeTruthy();
  });

  it("survives either search failing", async () => {
    mockApi.get("/v1/admin/series", fail(500, "boom"));
    mockApi.get("/v1/admin/users", { items: [user("u1")] });
    const u = setup();
    ctrlK();
    await typeAndSettle(u, "name");
    expect(screen.getByText("Name u1")).toBeTruthy();
  });

  it("a slow reply for an earlier query cannot overwrite the current results", async () => {
    let releaseOld!: () => void;
    mockApi.get("/v1/admin/series", async (c) => {
      if (c.query.q === "ol") {
        await new Promise<void>((r) => (releaseOld = r));
        return { items: [series("old", "Stale Result")] };
      }
      return { items: [series("new", "Fresh Result")] };
    });
    mockApi.get("/v1/admin/users", { items: [] });
    const u = setup();
    ctrlK();
    await typeAndSettle(u, "ol");
    await typeAndSettle(u, "d");
    expect(screen.getByText("Fresh Result")).toBeTruthy();
    await act(async () => {
      releaseOld();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.queryByText("Stale Result")).toBeNull();
    expect(screen.getByText("Fresh Result")).toBeTruthy();
  });

  it("clearing the query below two characters clears remote results", async () => {
    mockApi.get("/v1/admin/series", { items: [series("s1", "Zeta")] });
    mockApi.get("/v1/admin/users", { items: [] });
    const u = setup();
    ctrlK();
    await typeAndSettle(u, "zet");
    expect(screen.getByText("Zeta")).toBeTruthy();
    await u.clear(input());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.queryByText("Zeta")).toBeNull();
  });

  it("keyboard: arrows move (clamped), hover sets active, Enter opens the active one", async () => {
    const u = setup("owner");
    ctrlK();
    const rows = () => screen.getAllByRole("button").filter((b) => b.closest("li"));
    const isActive = (i: number) => rows()[i].className.includes("bg-surface-2");
    expect(isActive(0)).toBe(true);
    await u.keyboard("{ArrowUp}");
    expect(isActive(0)).toBe(true);
    await u.keyboard("{ArrowDown}{ArrowDown}");
    expect(isActive(2)).toBe(true);
    for (let i = 0; i < 40; i++) fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(isActive(rows().length - 1)).toBe(true);
    fireEvent.mouseEnter(rows()[1]);
    expect(isActive(1)).toBe(true);
    fireEvent.keyDown(input(), { key: "x" });
    await u.keyboard("{Enter}");
    expect(nav.router.push).toEqual(["/dramas"]);
  });

  it("Enter with no results does nothing; typing resets the active row", async () => {
    mockApi.get("/v1/admin/series", { items: [] });
    mockApi.get("/v1/admin/users", { items: [] });
    const u = setup();
    ctrlK();
    await u.keyboard("{ArrowDown}{ArrowDown}");
    await typeAndSettle(u, "qqqq");
    await u.keyboard("{Enter}");
    expect(nav.router.push).toEqual([]);
  });

  it("closing resets the query", async () => {
    const u = setup();
    ctrlK();
    await u.type(input(), "d");
    await u.click(screen.getByRole("button", { name: "Close" }));
    ctrlK();
    expect(input().value).toBe("");
  });

  it("caps results at 20", async () => {
    mockApi.get("/v1/admin/series", { items: Array.from({ length: 5 }, (_, i) => series(`s${i}`, `Show ${i}`)) });
    mockApi.get("/v1/admin/users", { items: Array.from({ length: 5 }, (_, i) => user(`u${i}`)) });
    const u = setup();
    ctrlK();
    await typeAndSettle(u, "sh");
    expect(screen.getAllByRole("button").filter((b) => b.closest("li")).length).toBeLessThanOrEqual(20);
  });
});
