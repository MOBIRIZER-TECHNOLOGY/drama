import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadCsv } from "./csv";

describe("downloadCsv", () => {
  afterEach(() => vi.unstubAllGlobals());

  function run(filename: string, rows: Record<string, unknown>[]) {
    let blob: Blob | undefined;
    const create = vi.fn((b: Blob) => ((blob = b), "blob:x"));
    const revoke = vi.fn();
    URL.createObjectURL = create as never;
    URL.revokeObjectURL = revoke;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadCsv(filename, [{ key: "a", label: "A,col" }, { key: "b", label: "B" }], rows);
    return { blob: blob!, anchor: click.mock.contexts[0] as HTMLAnchorElement, revoke };
  }

  it("escapes cells, guards formulas, adds a BOM and .csv extension", async () => {
    const { blob, anchor, revoke } = run("export", [
      { a: 'he said "hi"', b: "=SUM(A1)" },
      { a: "line\nbreak", b: null },
      { a: 5, b: "@x" },
    ]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).slice(1);
    expect(text).toBe('"A,col",B\r\n"he said ""hi""",\'=SUM(A1)\r\n"line\nbreak",\r\n5,\'@x');
    expect(blob.type).toBe("text/csv;charset=utf-8");
    expect(anchor.download).toBe("export.csv");
    expect(anchor.href).toBe("blob:x");
    expect(revoke).toHaveBeenCalledWith("blob:x");
    expect(document.body.querySelector("a")).toBeNull();
  });

  it("does not double the extension", () => {
    expect(run("x.csv", []).anchor.download).toBe("x.csv");
  });
});
