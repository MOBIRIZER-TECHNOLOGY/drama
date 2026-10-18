import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fail, mockApi } from "@/test/api";
import { nav } from "@/test/navigation";
import { renderPage } from "@/test/render";
import TranslationsPage from "./page";

type Data = {
  lang: string;
  source: Record<string, string>;
  target: Record<string, { value: string; source: string }>;
  missing: string[];
};

const hiData = (): Data => ({
  lang: "hi",
  source: {
    "app.title": "Katha",
    "cart.items": "You have {count} items",
    "btn.ok": "OK",
    "btn.save": "Save",
  },
  target: {
    "app.title": { value: "कथा", source: "human" },
    "cart.items": { value: "आपके पास {count} आइटम हैं", source: "ai" },
    "btn.ok": { value: "ठीक", source: "human" },
  },
  missing: ["btn.save"],
});
const languages = [
  { code: "en", name: "English", is_active: true, is_rtl: false, sort_order: 0 },
  { code: "hi", name: "Hindi", is_active: true, is_rtl: false, sort_order: 1 },
  { code: "ar", name: "Arabic", is_active: true, is_rtl: true, sort_order: 2 },
];

function setup(code = "hi", data: Data | ReturnType<typeof fail> = hiData()) {
  nav.set({ params: { code } });
  mockApi.get(`/v1/admin/translations/${code}`, data);
  mockApi.get("/v1/admin/languages", languages);
  return renderPage(<TranslationsPage />);
}
const box = (key: string) => screen.getByLabelText(`Translation for ${key}`) as HTMLInputElement;

describe("TranslationsPage view", () => {
  it("shows loading, the stats header and one row per key sorted by key", async () => {
    setup();
    expect(screen.getByText(/Loading/i)).toBeTruthy();
    await screen.findByLabelText("Translation for app.title");
    expect(screen.getByRole("heading", { name: "Translations · Hindi" })).toBeTruthy();
    expect(screen.getByText("3/4 translated · 1 missing · 1 by AI")).toBeTruthy();
    const keys = screen.getAllByLabelText(/^Translation for /).map((i) => i.getAttribute("aria-label"));
    expect(keys).toEqual(["Translation for app.title", "Translation for btn.ok", "Translation for btn.save", "Translation for cart.items"]);
    expect(box("btn.save").placeholder).toBe("missing");
    expect(box("app.title").value).toBe("कथा");
    expect(screen.getByText("4 keys")).toBeTruthy();
    const rowOf = (k: string) => box(k).closest("tr") as HTMLElement;
    expect(within(rowOf("btn.save")).getByText("missing")).toBeTruthy();
    expect(within(rowOf("cart.items")).getByText("ai")).toBeTruthy();
    expect(within(rowOf("btn.ok")).getByText("human")).toBeTruthy();
  });

  it("falls back to the code for the title while languages are unknown, and shows right-to-left", async () => {
    setup("ar", { lang: "ar", source: { a: "A" }, target: {}, missing: ["a"] });
    await screen.findByLabelText("Translation for a");
    expect(screen.getByRole("heading", { name: "Translations · Arabic" })).toBeTruthy();
    expect(screen.getByText(/0\/1 translated · 1 missing · 0 by AI · right-to-left/)).toBeTruthy();
    expect(box("a").getAttribute("dir")).toBe("rtl");
  });

  it("uses the code as title when the language is not in the catalogue", async () => {
    setup("zz", { lang: "zz", source: { a: "A" }, target: {}, missing: ["a"] });
    await screen.findByLabelText("Translation for a");
    expect(screen.getByRole("heading", { name: "Translations · zz" })).toBeTruthy();
  });

  it("shows an error with retry when the load fails", async () => {
    setup("hi", fail(500, "boom"));
    expect(await screen.findByText("boom")).toBeTruthy();
    mockApi.get("/v1/admin/translations/hi", hiData());
    await userEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByLabelText("Translation for app.title")).toBeTruthy();
  });

  it("shows the empty state when there are no source strings", async () => {
    setup("hi", { lang: "hi", source: {}, target: {}, missing: [] });
    expect(await screen.findByText("No source strings")).toBeTruthy();
    expect(screen.getByText("Seed English UI strings first.")).toBeTruthy();
  });

  it("source language hides the filter, import and AI actions", async () => {
    setup("en", { lang: "en", source: { a: "A" }, target: { a: { value: "A", source: "human" } }, missing: [] });
    await screen.findByLabelText("Translation for a");
    expect(screen.getByText(/English is the source language/)).toBeTruthy();
    expect(screen.queryByLabelText("Filter")).toBeNull();
    expect(screen.queryByText("Import CSV")).toBeNull();
    expect(screen.queryByRole("button", { name: /AI translate/ })).toBeNull();
    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.getByText("New value")).toBeTruthy();
    // rtl is never applied to the source language
    expect(box("a").getAttribute("dir")).toBeNull();
  });

  it("singular key count", async () => {
    setup("hi", { lang: "hi", source: { a: "A" }, target: {}, missing: ["a"] });
    expect(await screen.findByText("1 key")).toBeTruthy();
  });
});

describe("TranslationsPage filtering", () => {
  it("filters by state and searches keys, source text and translations", async () => {
    setup();
    await screen.findByLabelText("Translation for app.title");
    const filter = screen.getByLabelText("Filter");
    await userEvent.selectOptions(filter, "missing");
    expect(screen.getAllByLabelText(/^Translation for /)).toHaveLength(1);
    expect(box("btn.save")).toBeTruthy();
    await userEvent.selectOptions(filter, "ai");
    expect(screen.getAllByLabelText(/^Translation for /).map((i) => i.getAttribute("aria-label"))).toEqual(["Translation for cart.items"]);
    await userEvent.selectOptions(filter, "human");
    expect(screen.getAllByLabelText(/^Translation for /)).toHaveLength(2);
    await userEvent.selectOptions(filter, "all");

    const search = screen.getByPlaceholderText("Search keys or text…");
    await userEvent.type(search, "CART");
    expect(screen.getAllByLabelText(/^Translation for /)).toHaveLength(1);
    await userEvent.clear(search);
    await userEvent.type(search, "you have");
    expect(box("cart.items")).toBeTruthy();
    await userEvent.clear(search);
    await userEvent.type(search, "ठीक");
    expect(screen.getAllByLabelText(/^Translation for /).map((i) => i.getAttribute("aria-label"))).toEqual(["Translation for btn.ok"]);
    await userEvent.clear(search);
    await userEvent.type(search, "nothing-matches");
    expect(screen.getByText("No keys match")).toBeTruthy();
    expect(screen.getByText("0 keys")).toBeTruthy();
  });

  it("windows long lists and loads more on demand", async () => {
    const source: Record<string, string> = {};
    for (let i = 0; i < 450; i++) source[`k${String(i).padStart(3, "0")}`] = `S${i}`;
    setup("hi", { lang: "hi", source, target: {}, missing: Object.keys(source) });
    await screen.findByLabelText("Translation for k000");
    expect(screen.getAllByLabelText(/^Translation for /)).toHaveLength(200);
    expect(screen.getByText("Showing 200 of 450")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Load 200 more" }));
    expect(screen.getAllByLabelText(/^Translation for /)).toHaveLength(400);
    await userEvent.click(screen.getByRole("button", { name: "Load 50 more" }));
    expect(screen.getAllByLabelText(/^Translation for /)).toHaveLength(450);
    expect(screen.queryByText(/Showing/)).toBeNull();
    // changing the search resets the window
    await userEvent.type(screen.getByPlaceholderText("Search keys or text…"), "k1");
    expect(screen.getAllByLabelText(/^Translation for /)).toHaveLength(100);
  });
});

describe("TranslationsPage editing and saving", () => {
  it("tracks drafts, marks edited rows and saves only changed non-empty values as human", async () => {
    setup();
    mockApi.put("/v1/admin/translations/hi", { ok: true });
    await screen.findByLabelText("Translation for app.title");
    const save = screen.getByRole("button", { name: /^Save/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await userEvent.type(box("btn.save"), "सहेजें");
    await userEvent.clear(box("btn.ok"));
    await userEvent.type(box("btn.ok"), "ठीक");
    // back to the original value -> not dirty
    await userEvent.type(box("app.title"), "x");
    await userEvent.type(box("app.title"), "{Backspace}");
    expect(within(box("btn.save").closest("tr") as HTMLElement).getByText("edited")).toBeTruthy();
    expect(within(box("app.title").closest("tr") as HTMLElement).queryByText("edited")).toBeNull();
    expect(screen.getByRole("button", { name: "Save (1)" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save (1)" }));
    expect(await screen.findByText("Saved 1 strings")).toBeTruthy();
    expect(mockApi.callsTo("PUT", "/v1/admin/translations/hi")[0].body).toEqual({ messages: { "btn.save": "सहेजें" }, source: "human" });
    // local state now reflects the save: row is human and no longer missing; draft cleared
    const row = box("btn.save").closest("tr") as HTMLElement;
    expect(within(row).getByText("human")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Save/ }).hasAttribute("disabled")).toBe(true);
  });

  it("refuses a save when every dirty value is blank", async () => {
    setup();
    await screen.findByLabelText("Translation for app.title");
    await userEvent.clear(box("app.title"));
    await userEvent.click(screen.getByRole("button", { name: "Save (1)" }));
    expect(await screen.findByText("Nothing to save: empty values are ignored")).toBeTruthy();
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
  });

  it("flags broken placeholders inline and blocks the whole save", async () => {
    setup();
    await screen.findByLabelText("Translation for app.title");
    await userEvent.clear(box("cart.items"));
    await userEvent.type(box("cart.items"), "आइटम {{total}");
    const alert = within(box("cart.items").closest("td") as HTMLElement).getByRole("alert");
    expect(alert.textContent).toContain("missing {count}; unknown {total}");
    expect(box("cart.items").getAttribute("aria-invalid")).toBe("true");
    await userEvent.type(box("btn.save"), "ok {{x}");
    await userEvent.click(screen.getByRole("button", { name: "Save (2)" }));
    const msg = await screen.findByText(/2 strings would break/);
    expect(msg.textContent).toMatch(/cart\.items \(missing \{count\}; unknown \{total\}\)/);
    expect(msg.textContent).toMatch(/btn\.save \(unknown \{x\}\)/);
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
  });

  it("uses the singular and truncates the list to three when strings would break", async () => {
    const source: Record<string, string> = { a: "{n}", b: "{n}", c: "{n}", d: "{n}" };
    setup("hi", { lang: "hi", source, target: {}, missing: ["a", "b", "c", "d"] });
    await screen.findByLabelText("Translation for a");
    await userEvent.type(box("a"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save (1)" }));
    expect(await screen.findByText(/1 string would break: a \(missing \{n\}\)/)).toBeTruthy();
    for (const k of ["b", "c", "d"]) await userEvent.type(box(k), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save (4)" }));
    const msg = await screen.findByText(/4 strings would break/);
    expect(msg.textContent).not.toContain("d (");
  });

  it("warns when a translation is much longer than its source", async () => {
    setup();
    await screen.findByLabelText("Translation for app.title");
    await userEvent.type(box("btn.ok"), "x".repeat(40));
    expect(screen.getByText(/Much longer than the source/)).toBeTruthy();
  });

  it("reports a save failure and keeps the drafts", async () => {
    setup();
    mockApi.put("/v1/admin/translations/hi", fail(500, "write failed"));
    await screen.findByLabelText("Translation for app.title");
    await userEvent.type(box("btn.save"), "सहेजें");
    await userEvent.click(screen.getByRole("button", { name: "Save (1)" }));
    expect(await screen.findByText("write failed")).toBeTruthy();
    expect(box("btn.save").value).toBe("सहेजें");
    expect(screen.getByRole("button", { name: "Save (1)" })).toBeTruthy();
  });

  it("marks the page as having unsaved changes (leave prompt on in-app links)", async () => {
    setup();
    await screen.findByLabelText("Translation for app.title");
    await userEvent.type(box("btn.save"), "x");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const link = screen.getByRole("link", { name: /Languages/ });
    const notPrevented = fireEvent.click(link);
    expect(confirmSpy).toHaveBeenCalledWith("You have unsaved translations. Leave without saving?");
    expect(notPrevented).toBe(false);
    confirmSpy.mockRestore();
  });
});

describe("TranslationsPage CSV export / import", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    createObjectURL = vi.fn(() => "blob:x");
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true, writable: true });
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => clickSpy.mockRestore());

  it("exports every key with draft values winning over saved ones", async () => {
    setup();
    await screen.findByLabelText("Translation for app.title");
    await userEvent.type(box("btn.save"), "सहेजें");
    await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(blob);
    });
    expect(text).toContain("Key,English,hi,State");
    expect(text).toContain("btn.save,Save,सहेजें,missing");
    expect(text).toContain("app.title,Katha,कथा,human");
    expect(text).toContain("cart.items,You have {count} items,आपके पास {count} आइटम हैं,ai");
    expect(clickSpy).toHaveBeenCalled();
  });

  it("exports an untranslated key with an empty translation", async () => {
    setup();
    await screen.findByLabelText("Translation for app.title");
    await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(blob);
    });
    expect(text).toContain("btn.save,Save,,missing");
  });

  async function upload(csv: string) {
    const file = new File([csv], "t.csv", { type: "text/csv" });
    // jsdom's File lacks .text() in some versions
    if (typeof file.text !== "function") Object.defineProperty(file, "text", { value: () => Promise.resolve(csv) });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);
  }

  it("loads changed rows as drafts, skipping unknown, blank and unchanged ones", async () => {
    setup();
    await screen.findByLabelText("Translation for app.title");
    await upload(
      ["Key,English,hi,State", "btn.save,Save,सहेजें,missing", "app.title,Katha,कथा,human", "nope.key,X,y,", "btn.ok,OK,,human", ",,z,"].join("\n"),
    );
    expect(await screen.findByText("1 string loaded as drafts, 1 unknown key skipped. Review, then Save.")).toBeTruthy();
    expect(box("btn.save").value).toBe("सहेजें");
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Save (1)" })).toBeTruthy();
  });

  it("pluralises the draft and unknown counts, and falls back to the third column", async () => {
    setup();
    await screen.findByLabelText("Translation for app.title");
    await upload(["key,english,translated", "btn.save,Save,A", "cart.items,x,B {count}", "u1,x,x", "u2,x,x"].join("\r\n"));
    expect(await screen.findByText("2 strings loaded as drafts, 2 unknown keys skipped. Review, then Save.")).toBeTruthy();
    expect(box("btn.save").value).toBe("A");
  });

  it("tolerates short rows", async () => {
    setup();
    await screen.findByLabelText("Translation for app.title");
    await upload("english,key,hi\nonly-one\nSave,btn.save\nSave,btn.save,A\n");
    expect(await screen.findByText("1 string loaded as drafts. Review, then Save.")).toBeTruthy();
    expect(box("btn.save").value).toBe("A");
  });

  it("ignores an import chosen before the translations have loaded", async () => {
    nav.set({ params: { code: "hi" } });
    let release: (v: unknown) => void = () => {};
    mockApi.get("/v1/admin/translations/hi", () => new Promise((r) => (release = r)));
    mockApi.get("/v1/admin/languages", languages);
    renderPage(<TranslationsPage />);
    await upload("key,hi\nbtn.save,A\n");
    expect(screen.queryByRole("status")).toBeNull();
    release(hiData());
    await screen.findByLabelText("Translation for app.title");
    expect(box("btn.save").value).toBe("");
  });

  it("says when nothing is new", async () => {
    setup();
    await screen.findByLabelText("Translation for app.title");
    await upload("key,hi\napp.title,कथा\n");
    expect(await screen.findByText("Nothing new in that file")).toBeTruthy();
  });

  it("omits the unknown suffix when all keys are known", async () => {
    setup();
    await screen.findByLabelText("Translation for app.title");
    await upload("key,hi\nbtn.save,A\n");
    expect(await screen.findByText("1 string loaded as drafts. Review, then Save.")).toBeTruthy();
  });

  it("rejects an empty file", async () => {
    setup();
    await screen.findByLabelText("Translation for app.title");
    await upload("\n\n");
    expect(await screen.findByText("That file has no rows")).toBeTruthy();
  });

  it("rejects a file with no key column", async () => {
    setup();
    await screen.findByLabelText("Translation for app.title");
    await upload("id,english,hi\nbtn.save,Save,A\n");
    expect(await screen.findByText('Expected a "key" column and a column named after the language')).toBeTruthy();
  });

  it("does nothing when the file picker is cancelled", async () => {
    setup();
    await screen.findByLabelText("Translation for app.title");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("TranslationsPage AI translate", () => {
  it("is disabled when nothing is missing", async () => {
    setup("hi", { lang: "hi", source: { a: "A" }, target: { a: { value: "x", source: "human" } }, missing: [] });
    await screen.findByLabelText("Translation for a");
    expect((screen.getByRole("button", { name: /AI translate missing/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("queues missing keys and offers a refresh", async () => {
    setup();
    mockApi.post("/v1/admin/translations/hi/ai", { queued: 3, job_id: "j1" });
    await screen.findByLabelText("Translation for app.title");
    await userEvent.click(screen.getByRole("button", { name: /AI translate missing/ }));
    expect(await screen.findByText(/Queued 3 keys for AI translation \(job j1\)/)).toBeTruthy();
    expect(mockApi.callsTo("POST", "/v1/admin/translations/hi/ai")[0].body).toEqual({ keys: null });
    const before = mockApi.callsTo("GET", "/v1/admin/translations/hi").length;
    await userEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    await waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/translations/hi").length).toBe(before + 1));
  });

  it("queued without a job id, and a zero result", async () => {
    setup();
    mockApi.post("/v1/admin/translations/hi/ai", { queued: 1 });
    await screen.findByLabelText("Translation for app.title");
    await userEvent.click(screen.getByRole("button", { name: /AI translate missing/ }));
    expect(await screen.findByText(/Queued 1 keys for AI translation\. Refresh in a minute\./)).toBeTruthy();
    mockApi.post("/v1/admin/translations/hi/ai", {});
    await userEvent.click(screen.getByRole("button", { name: /AI translate missing/ }));
    expect(await screen.findByText(/Nothing to translate: no missing keys\./)).toBeTruthy();
    expect(screen.getByText("No missing keys")).toBeTruthy();
  });

  it("reports a failure to queue", async () => {
    setup();
    mockApi.post("/v1/admin/translations/hi/ai", fail(503, "queue down"));
    await screen.findByLabelText("Translation for app.title");
    await userEvent.click(screen.getByRole("button", { name: /AI translate missing/ }));
    expect(await screen.findByText("queue down")).toBeTruthy();
  });

  it("keeps the rows and shows an inline error when a refresh fails", async () => {
    setup();
    mockApi.post("/v1/admin/translations/hi/ai", { queued: 1 });
    await screen.findByLabelText("Translation for app.title");
    await userEvent.click(screen.getByRole("button", { name: /AI translate missing/ }));
    await screen.findAllByText(/Queued 1 keys/);
    mockApi.get("/v1/admin/translations/hi", fail(500, "refresh broke"));
    await userEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    expect(await screen.findByText("refresh broke")).toBeTruthy();
    expect(box("app.title")).toBeTruthy();
  });
});
