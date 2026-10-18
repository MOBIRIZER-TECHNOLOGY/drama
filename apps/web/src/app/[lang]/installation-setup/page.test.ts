import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));

import { permanentRedirect } from "next/navigation";
import Page from "./page";

describe("installation-setup", () => {
  it("permanently redirects to the CMS page in the viewer's language", async () => {
    await expect(Page({ params: Promise.resolve({ lang: "hi" }) })).rejects.toThrow("NEXT_REDIRECT:/hi/p/installation-setup");
    await expect(Page({ params: Promise.resolve({ lang: "en" }) })).rejects.toThrow("NEXT_REDIRECT:/p/installation-setup");
    expect(permanentRedirect).toHaveBeenCalledTimes(2);
  });
});
