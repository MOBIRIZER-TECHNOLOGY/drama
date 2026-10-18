import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@/test/dialog-polyfill";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import PagesPage from "./page";

const langs = [
  { code: "en", name: "English", is_active: true },
  { code: "hi", name: "Hindi", is_active: true },
  { code: "ar", name: "Arabic", is_active: false },
];
const terms = { id: "p1", slug: "terms", title: "Terms", languages: ["en", "hi"], is_published: true, show_in_footer: true };
const about = { id: "p2", slug: "about", title: null, languages: [], is_published: false, show_in_footer: false };
const privacy = { id: "p3", slug: "privacy", title: "Privacy", languages: ["en"], is_published: true, show_in_footer: false };

function list(items: unknown[], total = items.length) {
  mockApi.get("/v1/admin/pages", { items, total });
}
function detail(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    slug: "terms",
    show_in_footer: true,
    is_published: true,
    translations: [
      { lang: "en", title: "Terms", body_html: "<p>en body</p>" },
      { lang: "hi", title: "शर्तें", body_html: "<p>hi body</p>" },
    ],
    ...over,
  };
}
function rowOf(slug: string) {
  return screen.getByText(`/${slug}`).closest("tr") as HTMLElement;
}
async function render(items: unknown[] = [terms, about, privacy], total?: number) {
  mockApi.get("/v1/admin/languages", langs);
  list(items, total);
  renderPage(<PagesPage />);
  if (items.length) await screen.findByText(`/${(items[0] as { slug: string }).slug}`);
}

afterEach(() => vi.useRealTimers());

describe("PagesPage list", () => {
  it("shows loading, then rows with language badges, missing-language hints and flags", async () => {
    mockApi.get("/v1/admin/languages", langs);
    list([terms, about, privacy]);
    renderPage(<PagesPage />);
    expect(screen.getByText(/Loading/i)).toBeTruthy();
    await screen.findByText("/terms");
    expect(screen.getByText("3 pages")).toBeTruthy();
    const t = rowOf("terms");
    expect(within(t).getByText("Terms")).toBeTruthy();
    expect(within(t).getByText("published")).toBeTruthy();
    expect(within(t).getByText("footer")).toBeTruthy();
    expect(within(t).queryByText("hi?")).toBeNull();
    const a = rowOf("about");
    expect(within(a).getByText("none")).toBeTruthy();
    expect(within(a).getByText("draft")).toBeTruthy();
    expect(within(a).getByText("—")).toBeTruthy();
    // active languages only: ar is inactive, so it is never reported missing
    await waitFor(() => expect(within(a).getByText("en?")).toBeTruthy());
    expect(within(a).getByText("hi?")).toBeTruthy();
    expect(within(a).queryByText("ar?")).toBeNull();
    expect(within(rowOf("privacy")).getByText("hi?")).toBeTruthy();
    expect(mockApi.callsTo("GET", "/v1/admin/pages")[0].query).toEqual({ limit: "25", offset: "0" });
  });

  it("falls back to English as the only expected language when the catalogue is empty or fails", async () => {
    mockApi.get("/v1/admin/languages", fail(500, "x"));
    list([privacy, about]);
    renderPage(<PagesPage />);
    await screen.findByText("/privacy");
    expect(within(rowOf("privacy")).queryByText(/\?$/)).toBeNull();
    expect(within(rowOf("about")).getByText("en?")).toBeTruthy();
  });

  it("shows the empty state with creation advice", async () => {
    await render([]);
    expect(await screen.findByText("No pages")).toBeTruthy();
    expect(screen.getByText(/Create Terms of Service/)).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
  });

  it("shows an error with retry", async () => {
    mockApi.get("/v1/admin/languages", langs);
    mockApi.get("/v1/admin/pages", fail(500, "pages down"));
    renderPage(<PagesPage />);
    expect(await screen.findByText("pages down")).toBeTruthy();
    list([terms]);
    await userEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByText("/terms")).toBeTruthy();
  });

  it("debounces search by 300ms, trims it, and resets the offset", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await render([terms], 60);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/pages").at(-1)!.query.offset).toBe("25"));
    const n = mockApi.callsTo("GET", "/v1/admin/pages").length;
    fireEvent.change(screen.getByPlaceholderText("Search slug or title…"), { target: { value: "  priv " } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(mockApi.callsTo("GET", "/v1/admin/pages").every((c) => c.query.q === undefined)).toBe(true);
    list([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/pages").length).toBeGreaterThan(n));
    expect(mockApi.callsTo("GET", "/v1/admin/pages").at(-1)!.query).toEqual({ q: "priv", limit: "25", offset: "0" });
    expect(await screen.findByText("No matches")).toBeTruthy();
    expect(screen.getByText("Nothing matches “priv”.")).toBeTruthy();
  });

  it("paginates", async () => {
    await render([terms], 60);
    expect(screen.getByText(/of 60 · page 1 of 3/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/pages").at(-1)!.query.offset).toBe("25"));
  });
});

describe("PagesPage delete", () => {
  it("confirms, deletes and updates the count", async () => {
    await render();
    mockApi.delete("/v1/admin/pages/p3", undefined);
    await userEvent.click(screen.getByRole("button", { name: "Delete privacy" }));
    expect(screen.getByText("Delete /privacy in all languages?")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" }).at(-1)!);
    await waitFor(() => expect(screen.queryByText("/privacy")).toBeNull());
    expect(screen.getByText("2 pages")).toBeTruthy();
    expect(await screen.findByText("Deleted /privacy")).toBeTruthy();
    expect(mockApi.callsTo("DELETE", "/v1/admin/pages/p3")).toHaveLength(1);
  });

  it("keeps the row on failure", async () => {
    await render();
    mockApi.delete("/v1/admin/pages/p3", fail(409, "page is pinned"));
    await userEvent.click(screen.getByRole("button", { name: "Delete privacy" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" }).at(-1)!);
    expect(await screen.findByText("page is pinned")).toBeTruthy();
    expect(screen.getByText("/privacy")).toBeTruthy();
  });

  it("cancel does not call the API", async () => {
    await render();
    await userEvent.click(screen.getByRole("button", { name: "Delete privacy" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockApi.callsTo("DELETE")).toHaveLength(0);
  });
});

describe("PageDialog edit", () => {
  it("fetches the page, shows its translations per language tab, and saves changes via PUT", async () => {
    await render();
    mockApi.get("/v1/admin/pages/p1", detail());
    mockApi.put("/v1/admin/pages/p1", (c) => ({ id: "p1", ...c.body }));
    await userEvent.click(within(rowOf("terms")).getByRole("button", { name: "Edit" }));
    expect(await screen.findByText("Edit /terms")).toBeTruthy();
    expect((screen.getByLabelText(/Slug/) as HTMLInputElement).value).toBe("terms");
    expect((screen.getByLabelText(/Title \(en\)/) as HTMLInputElement).value).toBe("Terms");
    expect((screen.getByLabelText(/Body HTML \(en\)/) as HTMLTextAreaElement).value).toBe("<p>en body</p>");
    await userEvent.click(screen.getByRole("tab", { name: /hi/ }));
    expect((screen.getByLabelText(/Title \(hi\)/) as HTMLInputElement).value).toBe("शर्तें");
    await userEvent.clear(screen.getByLabelText(/Title \(hi\)/));
    await userEvent.type(screen.getByLabelText(/Title \(hi\)/), "  नियम  ");
    await userEvent.click(screen.getByRole("switch", { name: "Published" }));
    await userEvent.click(screen.getByRole("switch", { name: "Show in footer" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Page saved")).toBeTruthy();
    expect(mockApi.callsTo("PUT", "/v1/admin/pages/p1")[0].body).toEqual({
      slug: "terms",
      show_in_footer: false,
      is_published: false,
      translations: [
        { lang: "en", title: "Terms", body_html: "<p>en body</p>" },
        { lang: "hi", title: "नियम", body_html: "<p>hi body</p>" },
      ],
    });
    await waitFor(() => expect(within(rowOf("terms")).getByText("draft")).toBeTruthy());
    expect(within(rowOf("terms")).queryByText("footer")).toBeNull();
    expect(screen.getByText("3 pages")).toBeTruthy();
  });

  it("reports when the page cannot be opened", async () => {
    await render();
    mockApi.get("/v1/admin/pages/p1", fail(404, "page gone"));
    await userEvent.click(within(rowOf("terms")).getByRole("button", { name: "Edit" }));
    expect(await screen.findByText("page gone")).toBeTruthy();
    expect(screen.queryByText("Edit /terms")).toBeNull();
  });

  it("includes translation languages that are not active, and labels the first language as required", async () => {
    await render();
    mockApi.get(
      "/v1/admin/pages/p1",
      detail({ translations: [{ lang: "ar", title: "شروط", body_html: "" }, { lang: "en", title: "Terms", body_html: "" }] }),
    );
    await userEvent.click(within(rowOf("terms")).getByRole("button", { name: "Edit" }));
    await screen.findByText("Edit /terms");
    expect(screen.getAllByRole("tab").map((t) => t.textContent?.trim())).toEqual(["en", "hi", "ar"]);
    expect(screen.getByRole("tab", { name: /ar/ }).querySelector('[aria-label="has content"]')).toBeTruthy();
    expect(screen.getByRole("tab", { name: /hi/ }).querySelector('[aria-label="has content"]')).toBeNull();
  });

  it("shows the API error and stays open when saving fails", async () => {
    await render();
    mockApi.get("/v1/admin/pages/p1", detail());
    mockApi.put("/v1/admin/pages/p1", fail(422, "bad html"));
    await userEvent.click(within(rowOf("terms")).getByRole("button", { name: "Edit" }));
    await screen.findByText("Edit /terms");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("bad html")).toBeTruthy();
    expect(screen.getByText("Edit /terms")).toBeTruthy();
  });

  it("Cancel closes the dialog", async () => {
    await render();
    mockApi.get("/v1/admin/pages/p1", detail());
    await userEvent.click(within(rowOf("terms")).getByRole("button", { name: "Edit" }));
    await screen.findByText("Edit /terms");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Edit /terms")).toBeNull());
  });
});

describe("PageDialog create", () => {
  async function open() {
    await render();
    await userEvent.click(screen.getByRole("button", { name: /New page/ }));
    await screen.findByText("New page", { selector: "h2" });
  }

  it("requires a slug and a title, and jumps back to the first language", async () => {
    await open();
    await userEvent.click(screen.getByRole("tab", { name: /hi/ }));
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByText("Slug is required.")).toBeTruthy();
    expect(screen.getByText("Add a title in at least one language.")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /en/ }).getAttribute("aria-selected")).toBe("true");
    expect(mockApi.callsTo("POST")).toHaveLength(0);
    await userEvent.type(screen.getByLabelText(/Slug/), "x");
    expect(screen.queryByText("Slug is required.")).toBeNull();
    await userEvent.type(screen.getByLabelText(/Title \(en\)/), "T");
    expect(screen.queryByText("Add a title in at least one language.")).toBeNull();
  });

  it("rejects a badly formed slug", async () => {
    await open();
    await userEvent.type(screen.getByLabelText(/Slug/), "Bad Slug");
    await userEvent.type(screen.getByLabelText(/Title \(en\)/), "T");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByText("Use lowercase letters, digits and single hyphens.")).toBeTruthy();
    expect(mockApi.callsTo("POST")).toHaveLength(0);
  });

  it("derives the slug from the first title when blank and creates a page", async () => {
    await open();
    mockApi.post("/v1/admin/pages", (c) => ({ id: "new1", ...c.body }));
    await userEvent.type(screen.getByLabelText(/Title \(en\)/), "  Refund Policy ");
    await userEvent.type(screen.getByLabelText(/Body HTML \(en\)/), "<p>hi</p>");
    await userEvent.click(screen.getByRole("tab", { name: /hi/ }));
    await userEvent.type(screen.getByLabelText(/Title \(hi\)/), "वापसी");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Page created")).toBeTruthy();
    expect(mockApi.callsTo("POST", "/v1/admin/pages")[0].body).toEqual({
      slug: "refund-policy",
      show_in_footer: true,
      is_published: true,
      translations: [
        { lang: "en", title: "Refund Policy", body_html: "<p>hi</p>" },
        { lang: "hi", title: "वापसी", body_html: "" },
      ],
    });
    // appended to the list with the count bumped, titled from English
    const row = await waitFor(() => rowOf("refund-policy"));
    expect(within(row).getByText("Refund Policy")).toBeTruthy();
    expect(within(row).getByText("hi")).toBeTruthy();
    expect(screen.getByText("4 pages")).toBeTruthy();
  });

  it("titles a new row from its first translation when there is no English one", async () => {
    await open();
    mockApi.post("/v1/admin/pages", (c) => ({ id: "new2", ...c.body }));
    await userEvent.type(screen.getByLabelText(/Slug/), "contact");
    await userEvent.click(screen.getByRole("tab", { name: /hi/ }));
    await userEvent.type(screen.getByLabelText(/Title \(hi\)/), "संपर्क");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    const row = await waitFor(() => rowOf("contact"));
    expect(within(row).getByText("संपर्क")).toBeTruthy();
  });

  it("renders a saved page that came back without translations as untitled", async () => {
    await open();
    mockApi.post("/v1/admin/pages", (c) => ({ id: "n3", ...c.body, translations: [] }));
    await userEvent.type(screen.getByLabelText(/Slug/), "empty");
    await userEvent.type(screen.getByLabelText(/Title \(en\)/), "E");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    const row = await waitFor(() => rowOf("empty"));
    expect(within(row).getByText("none")).toBeTruthy();
    expect(within(row).getByText("—")).toBeTruthy();
  });

  it("shows the API error on create failure", async () => {
    await open();
    mockApi.post("/v1/admin/pages", fail(409, "slug taken"));
    await userEvent.type(screen.getByLabelText(/Slug/), "terms");
    await userEvent.type(screen.getByLabelText(/Title \(en\)/), "Terms");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("slug taken")).toBeTruthy();
  });

  it("creating from an empty/failed list seeds the table", async () => {
    mockApi.get("/v1/admin/languages", langs);
    mockApi.get("/v1/admin/pages", fail(500, "x"));
    mockApi.post("/v1/admin/pages", (c) => ({ id: "n", ...c.body }));
    renderPage(<PagesPage />);
    await screen.findByText("x");
    await userEvent.click(screen.getByRole("button", { name: /New page/ }));
    await userEvent.type(screen.getByLabelText(/Slug/), "faq");
    await userEvent.type(screen.getByLabelText(/Title \(en\)/), "FAQ");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("/faq")).toBeTruthy();
    expect(screen.getByText("1 pages")).toBeTruthy();
  });
});
