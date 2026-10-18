import "@/test/dramas-dom-matchers";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import { SeriesForm } from "./series-form";

const LANGS = [
  { code: "hi", name: "Hindi", is_active: true },
  { code: "en", name: "English", is_active: true },
  { code: "ta", name: "Tamil", is_active: false },
];
const CATS = [
  { id: "c1", name: "Romance", slug: "romance" },
  { id: "c2", name: "Thriller", slug: "thriller-x" },
];

const series = (over: Record<string, unknown> = {}) =>
  ({
    id: "s1",
    slug: "ashes",
    cover_url: null,
    banner_url: null,
    original_language: "hi",
    free_episodes: 3,
    episode_price: 10,
    is_featured: true,
    is_premium: false,
    status: "published",
    released_at: "2030-01-02T03:04:00Z",
    content_rating: "UA13",
    sort_weight: 4,
    visible_languages: ["hi"],
    territories: ["IN", "NP"],
    window_starts_at: null,
    window_ends_at: null,
    moderation_flags: ["violence"],
    moderation_note: "n",
    category_ids: ["c1"],
    tags: ["a"],
    translations: [
      { lang: "hi", title: "राख", synopsis: "syn", seo_title: "st", meta_description: "md", keywords: ["k"] },
      { lang: "en", title: "Ashes", synopsis: null, seo_title: null, meta_description: null, keywords: null },
    ],
    ...over,
  }) as never;

function setup(initial?: unknown, extra: { onDirtyChange?: (d: boolean) => void } = {}) {
  const onSaved = vi.fn();
  const view = renderPage(<SeriesForm initial={initial as never} onSaved={onSaved} onDirtyChange={extra.onDirtyChange} />);
  return { onSaved, ...view };
}
const lastBody = (method: string, path: string) => mockApi.callsTo(method, path).at(-1)?.body;
const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(name) });

beforeEach(() => {
  mockApi.get("/v1/admin/languages", LANGS);
  mockApi.get("/v1/admin/categories", CATS);
  mockApi.post("/v1/admin/series", (c) => ({ ...c.body, id: "new" }));
  mockApi.put("/v1/admin/series/*", (c) => ({ ...c.body, id: "s1" }));
});

describe("SeriesForm: create", () => {
  it("loads languages as tabs with the original marked, and shows create-mode hints", async () => {
    setup();
    expect(screen.getByText("Loading languages…")).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: /Hindi/ })).toHaveTextContent("original");
    expect(tab("English")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("button", { name: "Create series" })).toBeInTheDocument();
    expect(screen.getByText("Episodes can be added after the series is created.")).toBeInTheDocument();
    expect(screen.queryByText("Moderation")).toBeNull();
    expect(screen.queryByText(/Unsaved changes/)).toBeNull();
  });

  it("derives the slug from the original-language title on blur and creates the series", async () => {
    const { onSaved } = setup();
    await screen.findByRole("tab", { name: /Hindi/ });
    const title = screen.getByLabelText(/^Title/);
    await userEvent.type(title, "My Great Show");
    await userEvent.tab();
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("my-great-show");

    await userEvent.type(screen.getByLabelText("Synopsis"), "  A story ");
    await userEvent.type(screen.getByLabelText("SEO title"), "SEO");
    await userEvent.type(screen.getByLabelText("Meta description"), "Meta");
    await userEvent.type(screen.getByLabelText("Keywords"), "drama,thriller{Enter}");
    await userEvent.type(screen.getByLabelText("Tags"), "fresh{Enter}");
    await userEvent.click(screen.getByLabelText("Romance"));
    await userEvent.selectOptions(screen.getByLabelText("Content rating"), "A");
    await userEvent.selectOptions(screen.getByLabelText("Status"), "review");
    await userEvent.click(screen.getByRole("switch", { name: /Premium/ }));
    await userEvent.click(screen.getByRole("switch", { name: /Featured/ }));
    fireEvent.change(screen.getByLabelText("Sort weight"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Free episodes"), { target: { value: "-2" } });
    fireEvent.change(screen.getByLabelText("Episode price (coins)"), { target: { value: "25" } });
    await userEvent.type(screen.getByLabelText("Territories"), "in, np in");
    fireEvent.change(screen.getByLabelText("Released at"), { target: { value: "2030-05-06T07:08" } });
    fireEvent.change(screen.getByLabelText("Window starts at"), { target: { value: "2030-05-06T07:08" } });
    fireEvent.change(screen.getByLabelText("Window ends at"), { target: { value: "2030-06-06T07:08" } });
    await userEvent.click(screen.getByRole("button", { name: "Create series" }));

    expect(await screen.findByText("Series created")).toBeInTheDocument();
    expect(lastBody("POST", "/v1/admin/series")).toEqual({
      slug: "my-great-show",
      cover_url: null,
      banner_url: null,
      original_language: "hi",
      free_episodes: 0, // negative input is clamped by the field
      episode_price: 25,
      is_featured: true,
      is_premium: true,
      status: "review",
      released_at: new Date("2030-05-06T07:08").toISOString(),
      content_rating: "A",
      sort_weight: 7,
      visible_languages: null,
      territories: ["IN", "NP"],
      window_starts_at: new Date("2030-05-06T07:08").toISOString(),
      window_ends_at: new Date("2030-06-06T07:08").toISOString(),
      category_ids: ["c1"],
      tags: ["fresh"],
      translations: [
        { lang: "hi", title: "My Great Show", synopsis: "A story", seo_title: "SEO", meta_description: "Meta", keywords: ["drama", "thriller"] },
      ],
    });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "new" }));
  });

  it("does not overwrite an existing slug on blur", async () => {
    setup();
    await screen.findByRole("tab", { name: /Hindi/ });
    await userEvent.type(screen.getByLabelText("Slug"), "mine");
    await userEvent.type(screen.getByLabelText(/^Title/), "Other");
    await userEvent.tab();
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("mine");
  });

  it("validates title, slug, price, territories and window, and focuses the first problem", async () => {
    setup();
    await screen.findByRole("tab", { name: /Hindi/ });
    await userEvent.click(tab("English"));
    await userEvent.type(screen.getByLabelText("Slug"), "Bad Slug");
    fireEvent.change(screen.getByLabelText("Episode price (coins)"), { target: { value: "1.5" } });
    await userEvent.type(screen.getByLabelText("Territories"), "IN, USA");
    fireEvent.change(screen.getByLabelText("Window starts at"), { target: { value: "2030-06-06T07:08" } });
    fireEvent.change(screen.getByLabelText("Window ends at"), { target: { value: "2030-05-06T07:08" } });
    await userEvent.click(screen.getByRole("button", { name: "Create series" }));

    expect(screen.getByText("Add a title in at least one language.")).toBeInTheDocument();
    expect(screen.getByText("Use lowercase letters, digits and single hyphens.")).toBeInTheDocument();
    expect(screen.getByText("Must be a whole number of coins (or blank).")).toBeInTheDocument();
    expect(screen.getByText("“USA” is not a 2-letter ISO country code.")).toBeInTheDocument();
    expect(screen.getByText("The window must end after it starts.")).toBeInTheDocument();
    // jumps back to the original-language tab so the missing title is visible
    expect(tab("Hindi")).toHaveAttribute("aria-selected", "true");
    expect(mockApi.callsTo("POST", "/v1/admin/series")).toHaveLength(0);

    // editing each field clears its error
    await userEvent.type(screen.getByLabelText(/^Title/), "T");
    expect(screen.queryByText("Add a title in at least one language.")).toBeNull();
    await userEvent.type(screen.getByLabelText("Slug"), "x");
    expect(screen.queryByText("Use lowercase letters, digits and single hyphens.")).toBeNull();
    fireEvent.change(screen.getByLabelText("Episode price (coins)"), { target: { value: "2" } });
    expect(screen.queryByText("Must be a whole number of coins (or blank).")).toBeNull();
    await userEvent.type(screen.getByLabelText("Territories"), "X");
    expect(screen.queryByText(/is not a 2-letter ISO country code/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Window ends at"), { target: { value: "2030-07-06T07:08" } });
    expect(screen.queryByText("The window must end after it starts.")).toBeNull();
  });

  it("rejects a negative episode price", async () => {
    setup();
    await screen.findByRole("tab", { name: /Hindi/ });
    await userEvent.type(screen.getByLabelText(/^Title/), "T");
    fireEvent.change(screen.getByLabelText("Episode price (coins)"), { target: { value: "-1" } });
    await userEvent.click(screen.getByRole("button", { name: "Create series" }));
    expect(screen.getByText("Must be a whole number of coins (or blank).")).toBeInTheDocument();
  });

  it("clears free_episodes errors on edit (field clamps to >= 0)", async () => {
    setup();
    await screen.findByRole("tab", { name: /Hindi/ });
    fireEvent.change(screen.getByLabelText("Free episodes"), { target: { value: "abc" } });
    expect((screen.getByLabelText("Free episodes") as HTMLInputElement).value).toBe("0");
  });

  it("shows a save failure inline and as a toast, and re-enables the form", async () => {
    mockApi.post("/v1/admin/series", fail(409, "slug taken"));
    const { onSaved } = setup();
    await screen.findByRole("tab", { name: /Hindi/ });
    await userEvent.type(screen.getByLabelText(/^Title/), "T");
    await userEvent.click(screen.getByRole("button", { name: "Create series" }));
    expect(await screen.findAllByText("slug taken")).toHaveLength(2);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create series" })).not.toBeDisabled();
  });

  it("only sends translations that have a title, per language tab", async () => {
    setup();
    await screen.findByRole("tab", { name: /Hindi/ });
    await userEvent.type(screen.getByLabelText(/^Title/), "Hindi title");
    await userEvent.click(tab("English"));
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("");
    await userEvent.type(screen.getByLabelText("Synopsis"), "only synopsis");
    await userEvent.click(tab("Hindi"));
    // English has a synopsis but no title: no "has translation" dot, and it is not sent
    expect(within(tab("English")).queryByLabelText("has translation")).toBeNull();
    await userEvent.click(tab("English"));
    await userEvent.type(screen.getByLabelText(/^Title/), "English title");
    expect(within(tab("English")).getByLabelText("has translation")).toBeInTheDocument();
    // the slug was derived from the Hindi title when focus left it, and an English title never replaces it
    await userEvent.tab();
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("hindi-title");
    await userEvent.click(screen.getByRole("button", { name: "Create series" }));
    await screen.findByText("Series created");
    const langs = (lastBody("POST", "/v1/admin/series").translations as { lang: string }[]).map((t) => t.lang);
    expect(langs).toEqual(["hi", "en"]);
  });

  it("changing the original language re-marks the tab and keeps options in sync", async () => {
    setup();
    await screen.findByRole("tab", { name: /Hindi/ });
    await userEvent.selectOptions(screen.getByLabelText("Original language"), "en");
    expect(tab("English")).toHaveTextContent("original");
    expect(tab("Hindi")).not.toHaveTextContent("original");
    expect(screen.getByRole("option", { name: "English (en)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Tamil/ })).toBeNull(); // inactive language
  });
});

describe("SeriesForm: edit", () => {
  it("populates fields from the series and saves via PUT", async () => {
    const { onSaved } = setup(series());
    await screen.findByRole("tab", { name: /Hindi/ });
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("राख");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("ashes");
    expect((screen.getByLabelText("Territories") as HTMLInputElement).value).toBe("IN, NP");
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("published");
    expect((screen.getByLabelText("Content rating") as HTMLSelectElement).value).toBe("UA13");
    expect((screen.getByLabelText("Episode price (coins)") as HTMLInputElement).value).toBe("10");
    expect(screen.getByLabelText("Romance")).toBeChecked();
    expect(screen.getByLabelText("Thriller")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.queryByText("Episodes can be added after the series is created.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Series saved")).toBeInTheDocument();
    expect(mockApi.callsTo("PUT", "/v1/admin/series/s1")).toHaveLength(1);
    expect(lastBody("PUT", "/v1/admin/series/s1")).toMatchObject({
      slug: "ashes",
      visible_languages: ["hi"],
      territories: ["IN", "NP"],
      episode_price: 10,
      content_rating: "UA13",
      category_ids: ["c1"],
      tags: ["a"],
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("does not derive a slug on blur when editing", async () => {
    setup(series({ slug: "" }));
    await screen.findByRole("tab", { name: /Hindi/ });
    const t = screen.getByLabelText(/^Title/);
    await userEvent.type(t, "x");
    await userEvent.tab();
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("");
  });

  it("tracks dirtiness: hint, onDirtyChange, beforeunload guard; saving resets it", async () => {
    const onDirtyChange = vi.fn();
    setup(series(), { onDirtyChange });
    await screen.findByRole("tab", { name: /Hindi/ });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    await userEvent.type(screen.getByLabelText("Synopsis"), "!");
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Series saved");
    await waitFor(() => expect(screen.queryByText(/Unsaved changes/)).toBeNull());
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("does not count moderation note edits as unsaved changes", async () => {
    setup(series());
    await screen.findByRole("tab", { name: /Hindi/ });
    await userEvent.type(screen.getByLabelText("Decision note"), " more");
    expect(screen.queryByText(/Unsaved changes/)).toBeNull();
  });

  it("Ctrl+S saves only when there are unsaved changes", async () => {
    setup(series());
    await screen.findByRole("tab", { name: /Hindi/ });
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
    await userEvent.type(screen.getByLabelText("Synopsis"), "!");
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    await screen.findByText("Series saved");
    expect(mockApi.callsTo("PUT", "/v1/admin/series/s1")).toHaveLength(1);
  });

  it("clears moderation flags through the audited route with the note", async () => {
    mockApi.post("/v1/admin/moderation/series/s1", { ok: true });
    setup(series());
    await screen.findByRole("tab", { name: /Hindi/ });
    expect(screen.getByText("violence")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Decision note"));
    await userEvent.type(screen.getByLabelText("Decision note"), " reviewed ");
    await userEvent.click(screen.getByRole("button", { name: "Clear flags" }));
    expect(await screen.findByText("Flags cleared")).toBeInTheDocument();
    expect(lastBody("POST", "/v1/admin/moderation/series/s1")).toEqual({ action: "clear_flags", note: "reviewed" });
    expect(screen.getByText(/No flags/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear flags" })).toBeNull();
  });

  it("sends a null note when blank and reports a clear-flags failure", async () => {
    mockApi.post("/v1/admin/moderation/series/s1", fail(403, "nope"));
    setup(series({ moderation_note: null }));
    await screen.findByRole("tab", { name: /Hindi/ });
    await userEvent.click(screen.getByRole("button", { name: "Clear flags" }));
    expect(await screen.findByText("nope")).toBeInTheDocument();
    expect(lastBody("POST", "/v1/admin/moderation/series/s1")).toEqual({ action: "clear_flags", note: null });
    expect(screen.getByText("violence")).toBeInTheDocument();
  });

  it("copes with a series carrying null optional fields", async () => {
    setup(
      series({
        episode_price: null,
        content_rating: null,
        visible_languages: null,
        territories: null,
        moderation_flags: null,
        moderation_note: null,
        released_at: null,
        translations: [{ lang: "hi", title: "T", synopsis: null, seo_title: null, meta_description: null, keywords: null }],
      }),
    );
    await screen.findByRole("tab", { name: /Hindi/ });
    expect((screen.getByLabelText("Episode price (coins)") as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/No flags/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Series saved");
    expect(lastBody("PUT", "/v1/admin/series/s1")).toMatchObject({
      episode_price: null,
      content_rating: null,
      visible_languages: null,
      territories: null,
      released_at: null,
    });
  });
});

describe("SeriesForm: categories", () => {
  it("shows an error, an empty state and a loading state", async () => {
    mockApi.get("/v1/admin/categories", fail(500, "cats down"));
    const a = setup();
    expect(await screen.findByText("cats down")).toBeInTheDocument();
    a.unmount();
    mockApi.get("/v1/admin/categories", []);
    setup();
    expect(await screen.findByText("No categories yet.")).toBeInTheDocument();
  });

  it("shows Loading… while categories are in flight", async () => {
    mockApi.get("/v1/admin/categories", () => new Promise(() => {}));
    setup();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    await screen.findByRole("tab", { name: /Hindi/ });
  });

  it("toggling a category on and off updates the payload", async () => {
    setup(series());
    await screen.findByRole("tab", { name: /Hindi/ });
    await userEvent.click(screen.getByLabelText("Thriller"));
    await userEvent.click(screen.getByLabelText("Romance"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Series saved");
    expect(lastBody("PUT", "/v1/admin/series/s1").category_ids).toEqual(["c2"]);
  });
});

describe("SeriesForm: visible languages", () => {
  it("switches between every language and a chosen subset, warning on none", async () => {
    setup(series({ visible_languages: null }));
    await screen.findByRole("tab", { name: /Hindi/ });
    const every = screen.getByLabelText("Every language");
    expect(every).toBeChecked();
    expect(screen.queryByLabelText(/Hindi \(hi\)/)).toBeNull();
    await userEvent.click(every);
    expect(screen.getByLabelText("Hindi (hi)")).toBeChecked();
    expect(screen.getByLabelText("English (en)")).not.toBeChecked();
    await userEvent.click(screen.getByLabelText("English (en)"));
    await userEvent.click(screen.getByLabelText("Hindi (hi)"));
    await userEvent.click(screen.getByLabelText("English (en)"));
    expect(screen.getByText(/No languages selected/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("English (en)"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Series saved");
    expect(lastBody("PUT", "/v1/admin/series/s1").visible_languages).toEqual(["en"]);
    await userEvent.click(screen.getByLabelText("Every language"));
    await userEvent.click(screen.getByLabelText("Every language"));
    expect(screen.getByLabelText("Every language")).not.toBeChecked();
  });

  it("an empty selection is sent as null (every language)", async () => {
    setup(series({ visible_languages: [] }));
    await screen.findByRole("tab", { name: /Hindi/ });
    expect(screen.getByText(/No languages selected/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Series saved");
    expect(lastBody("PUT", "/v1/admin/series/s1").visible_languages).toBeNull();
  });
});

describe("SeriesForm: AI draft", () => {
  const draft = {
    title: "AI Title",
    slug: "AI Slug!",
    synopsis: "AI synopsis",
    genres: ["romance", "thriller-x", "unknown"],
    tags: [" ai ", "a", ""],
    seo_title: "S".repeat(100),
    meta_description: "M".repeat(300),
    keywords: ["kw"],
    content_rating: "U",
    confidence: 0.9,
    moderation_flags: [],
  };

  async function generate() {
    mockApi.post("/v1/admin/ai/series-metadata", draft);
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    await userEvent.type(screen.getByLabelText(/Seed/), "a logline");
    await userEvent.click(screen.getByRole("button", { name: /Generate draft/ }));
    await screen.findByRole("region", { name: "AI draft" });
    await userEvent.click(screen.getByRole("button", { name: /Apply to form/ }));
  }

  it("applies a draft when creating (slug, rating, tags, categories, truncated SEO) and can undo", async () => {
    setup();
    await screen.findByRole("tab", { name: /Hindi/ });
    await userEvent.type(screen.getByLabelText("Tags"), "mine{Enter}");
    await generate();
    expect(await screen.findByText("Draft applied to Hindi; review before saving.")).toBeInTheDocument();
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("AI Title");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("ai-slug");
    expect((screen.getByLabelText("Content rating") as HTMLSelectElement).value).toBe("U");
    expect((screen.getByLabelText("SEO title") as HTMLInputElement).value).toHaveLength(70);
    expect((screen.getByLabelText("Meta description") as HTMLInputElement).value).toHaveLength(200);
    expect(screen.getByLabelText("Romance")).toBeChecked();
    expect(screen.getByLabelText("Thriller")).toBeChecked();
    expect(screen.getByRole("button", { name: "Remove ai" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove mine" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("");
    expect(screen.getByLabelText("Romance")).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Remove ai" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove mine" })).toBeInTheDocument();
  });

  it("when editing, keeps the slug and rating, and undo returns to the tab it was applied on", async () => {
    setup(series({ content_rating: "UA13" }));
    await screen.findByRole("tab", { name: /Hindi/ });
    await userEvent.click(tab("English"));
    await generate();
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("ashes");
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("AI Title");
    await userEvent.click(tab("Hindi"));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(tab("English")).toHaveAttribute("aria-selected", "true");
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("Ashes");
  });

  it("a draft without slug or rating leaves those fields alone", async () => {
    mockApi.post("/v1/admin/ai/series-metadata", { ...draft, slug: "", content_rating: "", genres: [], tags: [] });
    setup();
    await screen.findByRole("tab", { name: /Hindi/ });
    await userEvent.type(screen.getByLabelText("Slug"), "keep");
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    await userEvent.type(screen.getByLabelText(/Seed/), "a logline");
    await userEvent.click(screen.getByRole("button", { name: /Generate draft/ }));
    await screen.findByRole("region", { name: "AI draft" });
    await userEvent.click(screen.getByRole("button", { name: /Apply to form/ }));
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("keep");
    expect((screen.getByLabelText("Content rating") as HTMLSelectElement).value).toBe("");
  });

  it("offers the transcript seed when editing and lists the form's languages", async () => {
    setup(series());
    await screen.findByRole("tab", { name: /Hindi/ });
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByRole("button", { name: /Seed from transcript/ })).toBeInTheDocument();
    const opts = within(screen.getByLabelText("Output language")).getAllByRole("option").map((o) => o.textContent);
    expect(opts).toEqual(["Hindi", "English"]);
  });
});

describe("SeriesForm: artwork", () => {
  it("accepts pasted cover and banner URLs and sends them", async () => {
    setup(series());
    await screen.findByRole("tab", { name: /Hindi/ });
    fireEvent.change(screen.getByLabelText("Cover (9:16) URL"), { target: { value: "covers/a.jpg" } });
    fireEvent.change(screen.getByLabelText("Banner (16:9) URL"), { target: { value: "https://x.test/b.jpg" } });
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await act(async () => {});
    await screen.findByText("Series saved");
    expect(lastBody("PUT", "/v1/admin/series/s1")).toMatchObject({ cover_url: "covers/a.jpg", banner_url: "https://x.test/b.jpg" });
  });
});
