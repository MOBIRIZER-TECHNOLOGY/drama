import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@/test/dialog-polyfill";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import SettingsPage from "./page";

const economy = { coins_enabled: true, currency: "INR", episode_price: 50, custom_note: "hello", extra: { a: 1 } };

async function load(ns = "economy", data: Record<string, unknown> = economy) {
  mockApi.get(`/v1/admin/settings/${ns}`, data);
  if (ns !== "economy") mockApi.get("/v1/admin/settings/economy", {});
  renderPage(<SettingsPage />);
  if (ns !== "economy") {
    await screen.findByText("No keys");
    await userEvent.click(screen.getByRole("tab", { name: ns }));
  }
  await screen.findByText(new RegExp(`^${ns} \\(`));
}
const keys = () => (screen.getAllByLabelText("Key") as HTMLInputElement[]).map((i) => i.value);
const rowByKey = (key: string) => (screen.getAllByLabelText("Key") as HTMLInputElement[]).find((i) => i.value === key)!.closest("tr") as HTMLElement;
const reviewBtn = () => screen.getByRole("button", { name: "Review and save" }) as HTMLButtonElement;
const jsonBox = (k: string) => rowByKey(k).querySelector("textarea") as HTMLTextAreaElement;
const dialog = () => screen.getByRole("dialog");

describe("SettingsPage namespaces", () => {
  it("starts on economy, with loading then rows and the description", async () => {
    mockApi.get("/v1/admin/settings/economy", economy);
    renderPage(<SettingsPage />);
    expect(screen.getByText(/Loading/i)).toBeTruthy();
    await screen.findByText("economy (5 keys)");
    expect(screen.getByText("Coin prices, default episode price, signup bonus.")).toBeTruthy();
    expect(keys()).toEqual(["coins_enabled", "currency", "episode_price", "custom_note", "extra"]);
    expect(reviewBtn().disabled).toBe(true);
  });

  it("switches namespace and loads that namespace's settings", async () => {
    await load();
    mockApi.get("/v1/admin/settings/auth", { email: true });
    await userEvent.click(screen.getByRole("tab", { name: "auth" }));
    await screen.findByText("auth (1 key)");
    expect(screen.getByText("Sign-in providers, OTP and session rules.")).toBeTruthy();
    expect(keys()).toEqual(["email"]);
  });

  it("shows an error with retry", async () => {
    mockApi.get("/v1/admin/settings/economy", fail(500, "settings down"));
    renderPage(<SettingsPage />);
    expect(await screen.findByText("settings down")).toBeTruthy();
    mockApi.get("/v1/admin/settings/economy", economy);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("economy (5 keys)")).toBeTruthy();
  });

  it("shows the empty state, and Add key from it creates a blank row", async () => {
    await load("economy", {});
    expect(screen.getByText("No keys")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: /Add key/ }).at(-1)!);
    expect(keys()).toEqual([""]);
    expect(screen.getByText("economy (1 key)")).toBeTruthy();
  });
});

describe("SettingsPage row rendering", () => {
  it("annotates known keys and typed controls, and flags custom and secret-looking keys", async () => {
    await load("economy", { ...economy, api_secret: "s", stripe_key: "k", public_key: "p" });
    const price = rowByKey("episode_price");
    expect(within(price).getByText("Episode price.")).toBeTruthy();
    expect(within(price).getByText("coins")).toBeTruthy();
    expect((within(price).getByLabelText("Value") as HTMLInputElement).value).toBe("50");
    expect(within(price).getByLabelText("Value").getAttribute("inputmode")).toBe("decimal");
    const flag = rowByKey("coins_enabled");
    expect((within(flag).getByLabelText("Value") as HTMLSelectElement).value).toBe("true");
    expect(within(rowByKey("currency")).getByLabelText("Value").getAttribute("inputmode")).toBeNull();
    expect(within(rowByKey("custom_note")).getByText(/Custom key — no schema/)).toBeTruthy();
    // strings are text, everything else is JSON, and JSON values get the editor
    expect((within(rowByKey("extra")).getByLabelText("Value type") as HTMLSelectElement).value).toBe("json");
    expect((jsonBox("extra") as HTMLTextAreaElement).value).toBe('{"a":1}');
    expect(within(rowByKey("api_secret")).getByText(/Looks like a secret/)).toBeTruthy();
    expect(within(rowByKey("stripe_key")).getByText(/Looks like a secret/)).toBeTruthy();
    expect(within(rowByKey("public_key")).queryByText(/Looks like a secret/)).toBeNull();
  });

  it("uses the JSON editor for schema-declared JSON values", async () => {
    await load("rewards", { daily_rewards: [1, 2, 3] });
    const box = jsonBox("daily_rewards") as HTMLTextAreaElement;
    expect(box.value).toBe("[1,2,3]");
  });

  it("treats a non-true boolean as false", async () => {
    await load("auth", { email: "nonsense" });
    expect((within(rowByKey("email")).getByLabelText("Value") as HTMLSelectElement).value).toBe("false");
  });

  it("removes a row", async () => {
    await load();
    await userEvent.click(screen.getByRole("button", { name: "Remove custom_note" }));
    expect(keys()).not.toContain("custom_note");
    expect(reviewBtn().disabled).toBe(false);
  });

  it("labels a blank row's remove button generically and adds rows with fresh ids", async () => {
    await load();
    await userEvent.click(screen.getAllByRole("button", { name: /Add key/ })[0]);
    await userEvent.click(screen.getAllByRole("button", { name: /Add key/ })[0]);
    expect(screen.getAllByRole("button", { name: "Remove row" })).toHaveLength(2);
  });
});

describe("SettingsPage review validation", () => {
  async function typeKey(index: number, key: string) {
    const inputs = screen.getAllByLabelText("Key");
    await userEvent.clear(inputs[index]);
    await userEvent.type(inputs[index], key);
  }

  it("requires a key and rejects duplicates", async () => {
    await load("economy", { a: "1" });
    await userEvent.click(screen.getByRole("button", { name: /Add key/ }));
    await userEvent.click(reviewBtn());
    expect(screen.getByText("Key is required.")).toBeTruthy();
    await typeKey(1, "a");
    await userEvent.click(reviewBtn());
    expect(screen.getByText("Duplicate key “a”.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
  });

  it("validates typed values and clears the error on edit", async () => {
    await load();
    const price = () => within(rowByKey("episode_price")).getByLabelText("Value");
    await userEvent.clear(price());
    await userEvent.type(price(), "abc");
    await userEvent.click(reviewBtn());
    expect(screen.getByText("Must be a number.")).toBeTruthy();
    expect(price().getAttribute("aria-invalid")).toBe("true");
    await userEvent.clear(price());
    expect(screen.queryByText("Must be a number.")).toBeNull();
    await userEvent.type(price(), "99999");
    await userEvent.click(reviewBtn());
    expect(screen.getByText("Must be at most 10000.")).toBeTruthy();
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
  });

  it("rejects malformed JSON on schema and custom keys", async () => {
    await load("rewards", { daily_rewards: [1], note: "x" });
    const ta = jsonBox("daily_rewards");
    fireEvent.change(ta, { target: { value: "[1," } });
    await userEvent.selectOptions(within(rowByKey("note")).getByLabelText("Value type"), "json");
    const noteBox = jsonBox("note");
    fireEvent.change(noteBox, { target: { value: "{nope" } });
    await userEvent.click(reviewBtn());
    expect(screen.getAllByText("Not valid JSON.")).toHaveLength(2);
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
  });

  it("says nothing to save when edits produce identical values", async () => {
    await load("economy", { note: "x" });
    // switching a string to JSON type changes the row but not the value written: "x" -> JSON.parse('"x"')
    fireEvent.change(within(rowByKey("note")).getByLabelText("Value type"), { target: { value: "json" } });
    fireEvent.change(jsonBox("note"), { target: { value: '"x"' } });
    await userEvent.click(reviewBtn());
    expect(await screen.findByText("Nothing to save")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("SettingsPage save flow", () => {
  it("shows a diff (sensitive, removed, added), then PUTs coerced types and re-seeds", async () => {
    await load();
    mockApi.put("/v1/admin/settings/economy", (c) => c.body.data);
    const price = within(rowByKey("episode_price")).getByLabelText("Value");
    await userEvent.clear(price);
    await userEvent.type(price, " 75 ");
    await userEvent.selectOptions(within(rowByKey("coins_enabled")).getByLabelText("Value"), "false");
    await userEvent.click(screen.getByRole("button", { name: "Remove custom_note" }));
    await userEvent.click(screen.getByRole("button", { name: /Add key/ }));
    const blank = screen.getAllByLabelText("Key").at(-1)!;
    await userEvent.type(blank, "brand_new");
    await userEvent.type(within(blank.closest("tr") as HTMLElement).getByLabelText("Value"), "v");
    await userEvent.click(reviewBtn());

    const d = within(dialog());
    expect(d.getByText("Save economy settings")).toBeTruthy();
    expect(d.getByText(/4 values will change/)).toBeTruthy();
    const li = (k: string) => d.getByText(k, { selector: "p" }).closest("li") as HTMLElement;
    expect(within(li("episode_price")).getByText("SENSITIVE")).toBeTruthy();
    expect(li("episode_price").textContent).toContain("50 → 75");
    expect(li("coins_enabled").textContent).toContain("true → false");
    expect(li("custom_note").textContent).toContain('"hello" → removed');
    expect(li("brand_new").textContent).toContain("unset → \"v\"");
    expect(within(li("brand_new")).queryByText("SENSITIVE")).toBeNull();
    expect(mockApi.callsTo("PUT")).toHaveLength(0);

    await userEvent.click(d.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Saved economy settings")).toBeTruthy();
    expect(mockApi.callsTo("PUT", "/v1/admin/settings/economy")[0].body).toEqual({
      data: { coins_enabled: false, currency: "INR", episode_price: 75, extra: { a: 1 }, brand_new: "v" },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // re-seeded from the response: nothing dirty any more
    await waitFor(() => expect(keys()).toEqual(["coins_enabled", "currency", "episode_price", "extra", "brand_new"]));
    expect(reviewBtn().disabled).toBe(true);
  });

  it("singular wording for a single change; cancel closes without saving", async () => {
    await load("economy", { currency: "INR" });
    await userEvent.type(within(rowByKey("currency")).getByLabelText("Value"), "X");
    await userEvent.click(reviewBtn());
    expect(within(dialog()).getByText(/1 value will change/)).toBeTruthy();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
    expect(reviewBtn().disabled).toBe(false);
  });

  it("writes custom JSON values parsed, and text values as typed", async () => {
    await load("economy", { cfg: { a: 1 }, label: "x" });
    mockApi.put("/v1/admin/settings/economy", (c) => c.body.data);
    fireEvent.change(jsonBox("cfg"), { target: { value: '{"a":2}' } });
    await userEvent.type(within(rowByKey("label")).getByLabelText("Value"), "y");
    await userEvent.click(reviewBtn());
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved economy settings");
    expect(mockApi.callsTo("PUT")[0].body).toEqual({ data: { cfg: { a: 2 }, label: "xy" } });
  });

  it("shows the API error inline and keeps the draft when the save fails", async () => {
    await load("economy", { currency: "INR" });
    mockApi.put("/v1/admin/settings/economy", fail(400, "rejected: looks like a secret"));
    await userEvent.type(within(rowByKey("currency")).getByLabelText("Value"), "X");
    await userEvent.click(reviewBtn());
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save changes" }));
    await screen.findAllByText("rejected: looks like a secret");
    expect(document.querySelector("p[role=alert]")?.textContent).toBe("rejected: looks like a secret");
    expect((within(rowByKey("currency")).getByLabelText("Value") as HTMLInputElement).value).toBe("INRX");
    // retrying clears the previous error on the next review
    await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    await userEvent.click(reviewBtn());
    expect(document.querySelector("p[role=alert]")).toBeNull();
  });

  it("Ctrl/Cmd+S opens the review when there are changes, and does nothing otherwise", async () => {
    await load("economy", { currency: "INR" });
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.type(within(rowByKey("currency")).getByLabelText("Value"), "X");
    fireEvent.keyDown(document, { key: "s", metaKey: true });
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("pressing Enter in a field neither submits the form nor saves", async () => {
    await load("economy", { currency: "INR" });
    await userEvent.type(within(rowByKey("currency")).getByLabelText("Value"), "X");
    const submitted = fireEvent.submit(rowByKey("currency").closest("form") as HTMLFormElement);
    expect(submitted).toBe(false); // default prevented
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
  });

  it("prompts before following a link while there are unsaved settings", async () => {
    await load("economy", { currency: "INR" });
    await userEvent.type(within(rowByKey("currency")).getByLabelText("Value"), "X");
    const spy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const a = document.createElement("a");
    a.href = "/dashboard";
    document.body.appendChild(a);
    fireEvent.click(a);
    expect(spy).toHaveBeenCalledWith("You have unsaved settings. Leave without saving?");
    a.remove();
    spy.mockRestore();
  });
});
