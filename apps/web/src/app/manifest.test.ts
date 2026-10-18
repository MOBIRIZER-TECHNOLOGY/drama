import { describe, expect, it } from "vitest";
import manifest from "./manifest";
import { colors } from "@/lib/tokens";

describe("manifest", () => {
  it("is an installable standalone portrait app using brand colours", () => {
    const m = manifest();
    expect(m).toMatchObject({ short_name: "Katha", display: "standalone", orientation: "portrait", start_url: "/", background_color: colors.ground, theme_color: colors.ground });
    expect(m.icons?.map((i) => i.sizes)).toEqual(["192x192", "512x512", "512x512"]);
    expect(m.icons?.some((i) => i.purpose === "maskable")).toBe(true);
    expect(m.shortcuts?.map((s) => s.url)).toEqual(["/shorts", "/rewards"]);
  });
});
