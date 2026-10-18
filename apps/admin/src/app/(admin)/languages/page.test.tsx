import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@/test/dialog-polyfill";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import LanguagesPage from "./page";

const en = { code: "en", name: "English", native_name: "English", is_active: true, is_rtl: false, sort_order: 0, ui_total: 100, ui_translated: 100, pages_total: 2, pages_translated: 2 };
const hi = { code: "hi", name: "Hindi", native_name: "हिन्दी", is_active: true, is_rtl: false, sort_order: 1, ui_total: 100, ui_translated: 97, pages_total: 4, pages_translated: 2 };
const ar = { code: "ar", name: "Arabic", native_name: null, is_active: false, is_rtl: true, sort_order: 1, ui_total: 100, ui_translated: 70, pages_total: 0, pages_translated: 0 };
const ta = { code: "ta", name: "Tamil", native_name: "தமிழ்", is_active: true, is_rtl: false, sort_order: 5, ui_total: 0, ui_translated: 0, pages_total: 0, pages_translated: 0 };

function rowOf(name: string) {
  return screen.getByRole("link", { name }).closest("tr") as HTMLElement;
}

describe("LanguagesPage list", () => {
  it("shows loading, then rows sorted by order then code with coverage badges", async () => {
    mockApi.get("/v1/admin/languages", [ta, hi, en, ar]);
    renderPage(<LanguagesPage />);
    expect(screen.queryByRole("table")).toBeNull();
    await screen.findByRole("link", { name: "Hindi" });
    const names = screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[1].textContent);
    expect(names).toEqual(["English", "Arabic", "Hindi", "Tamil"]);
    expect(within(rowOf("English")).getByText("source", { selector: "span.text-xs" })).toBeTruthy();
    expect(within(rowOf("English")).getAllByText("source")).toHaveLength(2);
    expect(within(rowOf("Hindi")).getByText("97% UI")).toBeTruthy();
    expect(within(rowOf("Hindi")).getByText(/97\/100 strings · 50% pages/)).toBeTruthy();
    expect(within(rowOf("Arabic")).getByText("70% UI")).toBeTruthy();
    expect(within(rowOf("Arabic")).getByText("rtl")).toBeTruthy();
    expect(within(rowOf("Arabic")).getByText("inactive")).toBeTruthy();
    expect(within(rowOf("Arabic")).getByText("—")).toBeTruthy();
    expect(within(rowOf("Arabic")).getByText(/70\/100 strings$/)).toBeTruthy();
    expect(within(rowOf("Tamil")).getByText("0% UI")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Hindi" }).getAttribute("href")).toBe("/languages/hi");
    expect((screen.getByRole("button", { name: "Delete English" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the empty state", async () => {
    mockApi.get("/v1/admin/languages", []);
    renderPage(<LanguagesPage />);
    expect(await screen.findByText("No languages")).toBeTruthy();
  });

  it("shows an error and retries", async () => {
    mockApi.get("/v1/admin/languages", fail(500, "db down"));
    renderPage(<LanguagesPage />);
    expect(await screen.findByText("db down")).toBeTruthy();
    mockApi.get("/v1/admin/languages", [hi]);
    await userEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByText("Hindi")).toBeTruthy();
  });
});

describe("LanguagesPage with a failed list", () => {
  it("can still add a language, which becomes the only row", async () => {
    mockApi.get("/v1/admin/languages", fail(500, "db down"));
    mockApi.put("/v1/admin/languages/hi", (c) => ({ ...c.body, ui_total: 0, ui_translated: 0, pages_total: 0, pages_translated: 0 }));
    renderPage(<LanguagesPage />);
    await screen.findByText("db down");
    await userEvent.click(screen.getByRole("button", { name: /Add language/ }));
    await userEvent.type(screen.getByLabelText(/Code/), "hi");
    await userEvent.type(screen.getByLabelText(/^Name/), "Hindi");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("link", { name: "Hindi" })).toBeTruthy();
  });
});

describe("LanguagesPage delete", () => {
  it("confirms, deletes and removes the row", async () => {
    mockApi.get("/v1/admin/languages", [en, hi]);
    mockApi.delete("/v1/admin/languages/hi", undefined);
    renderPage(<LanguagesPage />);
    await screen.findByRole("link", { name: "Hindi" });
    await userEvent.click(screen.getByRole("button", { name: "Delete Hindi" }));
    expect(screen.getByText(/Remove Hindi \(hi\)\?/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Hindi" })).toBeNull());
    expect(mockApi.callsTo("DELETE", "/v1/admin/languages/hi")).toHaveLength(1);
    expect(await screen.findByText("Removed Hindi")).toBeTruthy();
  });

  it("keeps the row and reports the error when delete fails", async () => {
    mockApi.get("/v1/admin/languages", [en, hi]);
    mockApi.delete("/v1/admin/languages/hi", fail(409, "in use"));
    renderPage(<LanguagesPage />);
    await screen.findByRole("link", { name: "Hindi" });
    await userEvent.click(screen.getByRole("button", { name: "Delete Hindi" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("in use")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Hindi" })).toBeTruthy();
  });

  it("cancel closes the confirmation without calling the API", async () => {
    mockApi.get("/v1/admin/languages", [en, hi]);
    renderPage(<LanguagesPage />);
    await screen.findByRole("link", { name: "Hindi" });
    await userEvent.click(screen.getByRole("button", { name: "Delete Hindi" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockApi.callsTo("DELETE")).toHaveLength(0);
    expect(screen.queryByText(/Remove Hindi/)).toBeNull();
  });
});

describe("LanguageDialog", () => {
  it("validates code and name before calling the API", async () => {
    mockApi.get("/v1/admin/languages", [en]);
    renderPage(<LanguagesPage />);
    await screen.findByRole("link", { name: "English" });
    await userEvent.click(screen.getByRole("button", { name: /Add language/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Code is required.")).toBeTruthy();
    expect(screen.getByText("Name is required.")).toBeTruthy();
    const code = screen.getByLabelText(/Code/);
    await userEvent.type(code, "x");
    expect(screen.queryByText("Code is required.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText(/BCP-47 style code such as/)).toBeTruthy();
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
    await userEvent.type(screen.getByLabelText(/^Name/), "n");
    expect(screen.queryByText("Name is required.")).toBeNull();
  });

  it("creates a language: normalises the code, trims, coerces sort order, and appends", async () => {
    mockApi.get("/v1/admin/languages", [en]);
    mockApi.put("/v1/admin/languages/pt-br", (c) => ({ ...c.body, ui_total: 0, ui_translated: 0, pages_total: 0, pages_translated: 0 }));
    renderPage(<LanguagesPage />);
    await screen.findByRole("link", { name: "English" });
    await userEvent.click(screen.getByRole("button", { name: /Add language/ }));
    await userEvent.type(screen.getByLabelText(/Code/), " PT-BR ");
    await userEvent.type(screen.getByLabelText(/^Name/), "  Portuguese ");
    await userEvent.type(screen.getByLabelText("Native name"), "  ");
    await userEvent.clear(screen.getByLabelText("Sort order"));
    await userEvent.type(screen.getByLabelText("Sort order"), "7");
    await userEvent.click(screen.getByRole("switch", { name: /Right-to-left/ }));
    await userEvent.click(screen.getByRole("switch", { name: /Active/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("link", { name: "Portuguese" })).toBeTruthy();
    expect(mockApi.callsTo("PUT", "/v1/admin/languages/pt-br")[0].body).toEqual({
      code: "pt-br", name: "Portuguese", native_name: null, is_active: false, is_rtl: true, sort_order: 7,
    });
    expect(screen.getByText("Language added")).toBeTruthy();
  });

  it("non-numeric sort order falls back to 0", async () => {
    mockApi.get("/v1/admin/languages", []);
    mockApi.put("/v1/admin/languages/hi", (c) => ({ ...c.body, ui_total: 0, ui_translated: 0, pages_total: 0, pages_translated: 0 }));
    renderPage(<LanguagesPage />);
    await screen.findByText("No languages");
    await userEvent.click(screen.getByRole("button", { name: /Add language/ }));
    await userEvent.type(screen.getByLabelText(/Code/), "hi");
    await userEvent.type(screen.getByLabelText(/^Name/), "Hindi");
    await userEvent.type(screen.getByLabelText("Native name"), "हिन्दी");
    await userEvent.clear(screen.getByLabelText("Sort order"));
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByRole("link", { name: "Hindi" });
    expect(mockApi.callsTo("PUT", "/v1/admin/languages/hi")[0].body).toMatchObject({ sort_order: 0, native_name: "हिन्दी" });
  });

  it("edits an existing language with the code locked and replaces the row", async () => {
    mockApi.get("/v1/admin/languages", [en, hi]);
    mockApi.put("/v1/admin/languages/hi", (c) => ({ ...hi, ...c.body }));
    renderPage(<LanguagesPage />);
    await screen.findByRole("link", { name: "Hindi" });
    await userEvent.click(within(rowOf("Hindi")).getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Edit Hindi")).toBeTruthy();
    const code = screen.getByLabelText(/Code/) as HTMLInputElement;
    expect(code.disabled).toBe(true);
    expect(code.value).toBe("hi");
    const name = screen.getByLabelText(/^Name/);
    await userEvent.clear(name);
    await userEvent.type(name, "Hindi (IN)");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("link", { name: "Hindi (IN)" })).toBeTruthy();
    expect(mockApi.callsTo("PUT", "/v1/admin/languages/hi")[0].body).toMatchObject({ code: "hi", name: "Hindi (IN)", sort_order: 1 });
    expect(screen.getByText("Language saved")).toBeTruthy();
  });

  it("edits a language that has no native name and saves it as null", async () => {
    mockApi.get("/v1/admin/languages", [ar]);
    mockApi.put("/v1/admin/languages/ar", (c) => ({ ...ar, ...c.body }));
    renderPage(<LanguagesPage />);
    await screen.findByRole("link", { name: "Arabic" });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((screen.getByLabelText("Native name") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("switch", { name: /Active/ }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: /Right-to-left/ }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsTo("PUT", "/v1/admin/languages/ar")).toHaveLength(1));
    expect(mockApi.callsTo("PUT", "/v1/admin/languages/ar")[0].body).toMatchObject({ native_name: null, is_active: false, is_rtl: true });
  });

  it("shows an API error and keeps the dialog open", async () => {
    mockApi.get("/v1/admin/languages", [en]);
    mockApi.put("/v1/admin/languages/hi", fail(422, "bad language"));
    renderPage(<LanguagesPage />);
    await screen.findByRole("link", { name: "English" });
    await userEvent.click(screen.getByRole("button", { name: /Add language/ }));
    await userEvent.type(screen.getByLabelText(/Code/), "hi");
    await userEvent.type(screen.getByLabelText(/^Name/), "Hindi");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("bad language")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });

  it("Cancel closes the dialog", async () => {
    mockApi.get("/v1/admin/languages", [en]);
    renderPage(<LanguagesPage />);
    await screen.findByRole("link", { name: "English" });
    await userEvent.click(screen.getByRole("button", { name: /Add language/ }));
    expect(screen.getByText("Add language", { selector: "h2" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Add language", { selector: "h2" })).toBeNull());
  });
});

void vi;
