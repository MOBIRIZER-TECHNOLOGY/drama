import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFieldErrors, validateEmbedHtml } from "./forms";
import { downloadCsv, parseCsv, useSaveShortcut, useUnsavedChanges } from "./editing";

describe("useFieldErrors", () => {
  function Form() {
    const { errors, setErrors, clearError, hasErrors, formRef } = useFieldErrors<"a" | "b">();
    return (
      <form ref={formRef}>
        <input aria-label="a" aria-invalid={errors.a ? true : undefined} />
        <input aria-label="b" aria-invalid={errors.b ? true : undefined} />
        <button type="button" onClick={() => setErrors({ b: "bad b", a: "bad a" })}>fail</button>
        <button type="button" onClick={() => setErrors({})}>none</button>
        <button type="button" onClick={() => clearError("a")}>clear a</button>
        <button type="button" onClick={() => clearError("b")}>clear b</button>
        <span data-testid="state">{hasErrors ? Object.keys(errors).sort().join(",") : "ok"}</span>
      </form>
    );
  }
  it("focuses the first invalid control and clears errors individually", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<Form />);
    fireEvent.click(screen.getByText("fail"));
    expect(screen.getByTestId("state").textContent).toBe("a,b");
    expect(document.activeElement).toBe(screen.getByLabelText("a"));
    expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    fireEvent.click(screen.getByText("clear a"));
    expect(screen.getByTestId("state").textContent).toBe("b");
    fireEvent.click(screen.getByText("clear a")); // absent key: no change
    expect(screen.getByTestId("state").textContent).toBe("b");
    fireEvent.click(screen.getByText("none"));
    expect(screen.getByTestId("state").textContent).toBe("ok");
  });
  it("tolerates scrollIntoView being unavailable", () => {
    // @ts-expect-error simulate old jsdom
    delete Element.prototype.scrollIntoView;
    render(<Form />);
    fireEvent.click(screen.getByText("fail"));
    expect(document.activeElement).toBe(screen.getByLabelText("a"));
  });
});

describe("validateEmbedHtml", () => {
  const ok = '<iframe src="https://www.youtube.com/embed/x" allowfullscreen></iframe>';
  it("accepts a single allowed iframe", () => {
    expect(validateEmbedHtml(ok)).toBeNull();
    expect(validateEmbedHtml('<iframe src="https://player.vimeo.com/video/1"></iframe>')).toBeNull();
  });
  it("rejects empty, wrong shapes and stray text", () => {
    expect(validateEmbedHtml("  ")).toMatch(/Paste/);
    expect(validateEmbedHtml("<div></div>")).toMatch(/single <iframe>/);
    expect(validateEmbedHtml(ok + ok)).toMatch(/single <iframe>/);
    expect(validateEmbedHtml("hello " + ok)).toMatch(/single <iframe>/);
    // HTML parsers treat iframe content as raw text, so nested markup never becomes child elements.
    expect(validateEmbedHtml('<iframe src="https://www.youtube.com/x"><b>x</b></iframe>')).toBeNull();
  });
  it("checks src", () => {
    expect(validateEmbedHtml("<iframe></iframe>")).toMatch(/absolute https/);
    expect(validateEmbedHtml('<iframe src="/rel"></iframe>')).toMatch(/absolute https/);
    expect(validateEmbedHtml('<iframe src="http://www.youtube.com/x"></iframe>')).toMatch(/https:\/\//);
    expect(validateEmbedHtml('<iframe src="https://evil.com/x"></iframe>')).toMatch(/Only YouTube/);
  });
  it("rejects event handlers and srcdoc", () => {
    expect(validateEmbedHtml('<iframe src="https://vimeo.com/1" onload="x()"></iframe>')).toBe("Attribute onload is not allowed.");
    expect(validateEmbedHtml('<iframe src="https://vimeo.com/1" srcdoc="x"></iframe>')).toBe("Attribute srcdoc is not allowed.");
  });
  it("skips DOM checks without DOMParser", () => {
    vi.stubGlobal("DOMParser", undefined);
    expect(validateEmbedHtml("<div/>")).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("useUnsavedChanges", () => {
  afterEach(() => vi.restoreAllMocks());
  function Page({ dirty }: { dirty: boolean }) {
    useUnsavedChanges(dirty);
    return (
      <div>
        <a href="/other">other</a>
        <a href="/blank" target="_blank">blank</a>
        <a href="#frag">frag</a>
        <a>nohref</a>
        <a href={window.location.pathname + window.location.search}>same</a>
        <span>text</span>
      </div>
    );
  }
  it("does nothing when clean", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Page dirty={false} />);
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByText("other"));
    expect(confirm).not.toHaveBeenCalled();
  });
  it("prompts on tab close when dirty", () => {
    render(<Page dirty />);
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
  it("blocks in-app navigation unless confirmed", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<Page dirty />);
    const link = screen.getByText("other");
    expect(fireEvent.click(link)).toBe(false); // prevented
    expect(confirm).toHaveBeenCalledWith("You have unsaved changes. Leave without saving?");
    expect(fireEvent.click(link)).toBe(true);
  });
  it("lets harmless clicks through", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Page dirty />);
    for (const name of ["blank", "frag", "nohref", "same", "text"]) fireEvent.click(screen.getByText(name));
    fireEvent.click(screen.getByText("other"), { ctrlKey: true });
    fireEvent.click(screen.getByText("other"), { metaKey: true });
    fireEvent.click(screen.getByText("other"), { button: 1 });
    expect(confirm).not.toHaveBeenCalled();
  });
  it("ignores already-prevented clicks and non-element targets", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Page dirty />);
    const link = screen.getByText("other");
    const prevent = (e: Event) => e.preventDefault();
    window.addEventListener("click", prevent, true); // runs before the hook's document-level capture
    fireEvent.click(link);
    window.removeEventListener("click", prevent, true);
    document.dispatchEvent(new MouseEvent("click", { bubbles: true })); // target is document: no closest
    expect(confirm).not.toHaveBeenCalled();
  });
  it("removes its listeners on cleanup", () => {
    const { unmount } = render(<Page dirty />);
    unmount();
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe("useSaveShortcut", () => {
  it("saves on ctrl/cmd+S only", () => {
    const save = vi.fn();
    const { rerender } = renderHook(({ enabled }) => useSaveShortcut(save, enabled), { initialProps: { enabled: true } });
    const press = (init: KeyboardEventInit) => {
      const e = new KeyboardEvent("keydown", { cancelable: true, ...init });
      document.dispatchEvent(e);
      return e;
    };
    expect(press({ key: "S", ctrlKey: true }).defaultPrevented).toBe(true);
    press({ key: "s", metaKey: true });
    expect(save).toHaveBeenCalledTimes(2);
    press({ key: "s" });
    press({ key: "x", ctrlKey: true });
    press({ key: "s", ctrlKey: true, altKey: true });
    expect(save).toHaveBeenCalledTimes(2);
    rerender({ enabled: false });
    press({ key: "s", ctrlKey: true });
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("defaults to enabled", () => {
    const save = vi.fn();
    renderHook(() => useSaveShortcut(save));
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true })));
    expect(save).toHaveBeenCalled();
  });
});

describe("downloadCsv", () => {
  async function capture(filename: string, rows: Record<string, unknown>[]) {
    let blob!: Blob;
    URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), "blob:x"));
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe(filename.endsWith(".csv") ? filename : `${filename}.csv`);
      expect(document.body.contains(this)).toBe(true);
    });
    downloadCsv(filename, [{ key: "a", label: "A, label" }, { key: "b", label: "B" }], rows);
    expect(click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
    expect(document.querySelector("a[download]")).toBeNull();
    return new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.readAsText(blob);
    });
  }
  it("escapes values, guards formulas and leaves numbers alone", async () => {
    const text = await capture("out", [
      { a: 'say "hi"', b: null },
      { a: "=SUM(A1)", b: -50 },
      { a: "line\nbreak", b: undefined },
      { a: "-x", b: "@y" },
    ]);
    expect(text.replace(/^﻿/, "").split("\r\n")).toEqual([
      '"A, label",B',
      '"say ""hi""",',
      "'=SUM(A1),-50",
      '"line\nbreak",',
      "'-x,'@y",
    ]);
  });
  it("does not double the .csv extension", async () => {
    await capture("report.csv", []);
  });
});

describe("parseCsv", () => {
  it("parses quoted fields, escaped quotes, embedded newlines and CRLF", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n"l1\nl2",z')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["l1\nl2", "z"],
    ]);
  });
  it("drops blank rows and handles a trailing field without newline", () => {
    expect(parseCsv("a,b\n\n , \nc,d")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseCsv("a\r")).toEqual([["a"]]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("a,")).toEqual([["a", ""]]);
  });
});
