import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import "@/test/admin-pages-dom";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import CategoriesPage from "./page";

const cat = (n: number, over: Record<string, unknown> = {}) => ({
  id: `c${n}`,
  name: `Cat ${n}`,
  slug: `cat-${n}`,
  show_on_home: true,
  sort_order: n,
  series_count: 3,
  translations: {},
  ...over,
});
const LANGS = [
  { code: "en", name: "English", is_rtl: false },
  { code: "hi", name: "Hindi", is_rtl: false },
  { code: "ur", name: "Urdu", is_rtl: true },
];
const ue = userEvent.setup();
const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

beforeEach(() => {
  mockApi.get("/v1/admin/languages", LANGS);
});

describe("CategoriesPage listing", () => {
  it("sorts by order then name and shows translation coverage, visibility and emptiness", async () => {
    mockApi.get("/v1/admin/categories", [
      cat(3, { name: "Zed", sort_order: 1 }),
      cat(1, { name: "Alpha", sort_order: 1, translations: { ur: "u", hi: "h" }, series_count: 0, show_on_home: false }),
      cat(2, { name: "Early", sort_order: 0 }),
    ]);
    renderPage(<CategoriesPage />);
    expect(screen.getByText(/Loading…/)).toBeTruthy();
    await screen.findByText("Early");
    const names = screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(names).toEqual(["Early", "Alpha", "Zed"]);
    const alpha = within(rowOf("Alpha"));
    expect(alpha.getByText("en, hi, ur")).toBeTruthy();
    expect(alpha.getByText("hidden")).toBeTruthy();
    expect(alpha.getByText("empty")).toBeTruthy();
    const early = within(rowOf("Early"));
    expect(early.getByText("en only")).toBeTruthy();
    expect(early.getByText("shown")).toBeTruthy();
    expect(early.getByText("3")).toBeTruthy();
  });

  it("tolerates rows with no translations or series count from the API", async () => {
    mockApi.get("/v1/admin/categories", [cat(1, { translations: null, series_count: null })]);
    renderPage(<CategoriesPage />);
    await screen.findByText("Cat 1");
    expect(within(rowOf("Cat 1")).getByText("en only")).toBeTruthy();
    await ue.click(screen.getByRole("button", { name: "Delete Cat 1" }));
    expect(within(screen.getByRole("dialog")).getByText("Delete “Cat 1”? Nothing is using it.")).toBeTruthy();
  });

  it("shows an empty state", async () => {
    mockApi.get("/v1/admin/categories", []);
    renderPage(<CategoriesPage />);
    expect(await screen.findByText("No categories")).toBeTruthy();
  });

  it("retries a failed load", async () => {
    mockApi.get("/v1/admin/categories", fail(500, "cats down"));
    renderPage(<CategoriesPage />);
    expect(await screen.findByText("cats down")).toBeTruthy();
    mockApi.get("/v1/admin/categories", [cat(1)]);
    await ue.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Cat 1")).toBeTruthy();
  });
});

describe("CategoriesPage deleting", () => {
  it("warns how many series are affected, deletes, and removes the row", async () => {
    mockApi.get("/v1/admin/categories", [cat(1), cat(2, { series_count: 0 })]);
    mockApi.delete("/v1/admin/categories/c1", undefined);
    mockApi.delete("/v1/admin/categories/c2", undefined);
    renderPage(<CategoriesPage />);
    await screen.findByText("Cat 1");
    await ue.click(screen.getByRole("button", { name: "Delete Cat 2" }));
    expect(within(screen.getByRole("dialog", { name: "Delete category" })).getByText("Delete “Cat 2”? Nothing is using it.")).toBeTruthy();
    await ue.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(mockApi.callsTo("DELETE")).toHaveLength(0);
    await ue.click(screen.getByRole("button", { name: "Delete Cat 1" }));
    const dlg = screen.getByRole("dialog", { name: "Delete category" });
    expect(within(dlg).getByText(/removed from 3 series, which keep their other categories/)).toBeTruthy();
    await ue.click(within(dlg).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Deleted “Cat 1”")).toBeTruthy();
    expect(screen.queryByText("Cat 1", { selector: "td" })).toBeNull();
    expect(screen.getByText("Cat 2")).toBeTruthy();
  });

  it("keeps the row and reports a failed delete", async () => {
    mockApi.get("/v1/admin/categories", [cat(1)]);
    mockApi.delete("/v1/admin/categories/c1", fail(409, "still referenced"));
    renderPage(<CategoriesPage />);
    await screen.findByText("Cat 1");
    await ue.click(screen.getByRole("button", { name: "Delete Cat 1" }));
    await ue.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("still referenced")).toBeTruthy();
    expect(screen.getByText("Cat 1", { selector: "td" })).toBeTruthy();
  });
});

describe("CategoriesPage dialog", () => {
  it("validates and auto-slugs a new category, with a translation field per non-English language", async () => {
    mockApi.get("/v1/admin/categories", []);
    mockApi.post("/v1/admin/categories", (c) => cat(9, c.body));
    renderPage(<CategoriesPage />);
    await screen.findByText("No categories");
    await ue.click(screen.getByRole("button", { name: /New category/ }));
    const dlg = screen.getByRole("dialog", { name: "New category" });
    await within(dlg).findByLabelText("Hindi (hi)");
    expect(within(dlg).queryByLabelText("English (en)")).toBeNull();
    expect(within(dlg).getByLabelText("Urdu (ur)").getAttribute("dir")).toBe("rtl");
    expect(within(dlg).getByLabelText("Hindi (hi)").getAttribute("dir")).toBeNull();

    await ue.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(within(dlg).getByText("Name is required.")).toBeTruthy();
    expect(within(dlg).getByText("Slug is required.")).toBeTruthy();
    expect(mockApi.callsTo("POST")).toHaveLength(0);

    await ue.type(within(dlg).getByLabelText(/Name/), "Rom Com!");
    expect((within(dlg).getByLabelText(/Slug/) as HTMLInputElement).value).toBe("rom-com");
    expect(within(dlg).queryByText("Name is required.")).toBeNull();
    expect(within(dlg).queryByText("Slug is required.")).toBeNull();
    await ue.type(within(dlg).getByLabelText("Hindi (hi)"), "रोम");
    await ue.clear(within(dlg).getByLabelText("Sort order"));
    await ue.type(within(dlg).getByLabelText("Sort order"), "7");
    await ue.click(within(dlg).getByRole("switch", { name: /Show on home/ }));
    await ue.clear(within(dlg).getByLabelText(/Slug/));
    await ue.type(within(dlg).getByLabelText(/Slug/), "Bad_Slug");
    await ue.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(within(dlg).getByText("Use lowercase letters, digits and single hyphens.")).toBeTruthy();

    await ue.clear(within(dlg).getByLabelText(/Slug/));
    await ue.type(within(dlg).getByLabelText(/Slug/), "rom-com");
    expect(within(dlg).queryByText(/single hyphens/)).toBeNull();
    await ue.click(within(dlg).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Category created")).toBeTruthy();
    expect(mockApi.callsTo("POST", "/v1/admin/categories")[0].body).toEqual({
      name: "Rom Com!",
      slug: "rom-com",
      show_on_home: false,
      sort_order: 7,
      translations: { hi: "रोम" },
    });
    expect(await screen.findByText("Rom Com!")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("derives the slug from the name when only the name is typed and the slug was cleared", async () => {
    mockApi.get("/v1/admin/categories", []);
    mockApi.post("/v1/admin/categories", (c) => cat(9, c.body));
    renderPage(<CategoriesPage />);
    await screen.findByText("No categories");
    await ue.click(screen.getByRole("button", { name: /New category/ }));
    const dlg = screen.getByRole("dialog");
    await ue.type(within(dlg).getByLabelText(/Name/), "Fantasy");
    await ue.clear(within(dlg).getByLabelText(/Slug/));
    await ue.click(within(dlg).getByRole("button", { name: "Create" }));
    await screen.findByText("Category created");
    expect(mockApi.callsTo("POST")[0].body.slug).toBe("fantasy");
  });

  it("edits an existing category with locked-in slug and prefilled translations, replacing its row", async () => {
    mockApi.get("/v1/admin/categories", [cat(1, { translations: { hi: "हिन्दी" } }), cat(2)]);
    mockApi.put("/v1/admin/categories/c1", (c) => cat(1, c.body));
    renderPage(<CategoriesPage />);
    await screen.findByText("Cat 1");
    await ue.click(within(rowOf("Cat 1")).getByRole("button", { name: "Edit" }));
    const dlg = screen.getByRole("dialog", { name: "Edit category" });
    expect((within(dlg).getByLabelText("Hindi (hi)") as HTMLInputElement).value).toBe("हिन्दी");
    await ue.clear(within(dlg).getByLabelText(/Name/));
    await ue.type(within(dlg).getByLabelText(/Name/), "Renamed");
    expect((within(dlg).getByLabelText(/Slug/) as HTMLInputElement).value).toBe("cat-1"); // editing never rewrites the slug
    await ue.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Category saved")).toBeTruthy();
    expect(mockApi.callsTo("PUT", "/v1/admin/categories/c1")[0].body).toMatchObject({ name: "Renamed", slug: "cat-1", translations: { hi: "हिन्दी" } });
    expect(await screen.findByText("Renamed")).toBeTruthy();
    expect(screen.queryByText("Cat 1", { selector: "td" })).toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("shows a loading hint while languages load and keeps the dialog on a failed save", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockApi.get("/v1/admin/languages", async () => {
      await gate;
      return LANGS;
    });
    mockApi.get("/v1/admin/categories", [cat(1)]);
    mockApi.put("/v1/admin/categories/c1", fail(500, "save failed hard"));
    renderPage(<CategoriesPage />);
    await screen.findByText("Cat 1");
    await ue.click(within(rowOf("Cat 1")).getByRole("button", { name: "Edit" }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText("Loading languages…")).toBeTruthy();
    release();
    await within(dlg).findByLabelText("Hindi (hi)");
    await ue.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("save failed hard")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Edit category" })).toBeTruthy();
  });

  it("closes with Cancel", async () => {
    mockApi.get("/v1/admin/categories", [cat(1)]);
    renderPage(<CategoriesPage />);
    await screen.findByText("Cat 1");
    await ue.click(screen.getByRole("button", { name: /New category/ }));
    await ue.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
