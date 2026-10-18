import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("accepts same-site paths with query and hash", () => {
    expect(safeNext("/wallet?x=1#top")).toBe("/wallet?x=1#top");
  });
  it.each(["", null, undefined])("rejects empty %s", (v) => {
    expect(safeNext(v)).toBeNull();
  });
  it.each(["//evil.com", "/\\evil.com", "https://evil.com/x", "http://katha.invalid.evil.com", "javascript:alert(1)", "\\\\evil.com"])(
    "rejects %s",
    (v) => {
      expect(safeNext(v)).toBeNull();
    },
  );
  it("rejects values the URL parser throws on", () => {
    expect(safeNext("http://[bad")).toBeNull();
  });
});
