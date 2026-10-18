import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));

import { notFound } from "next/navigation";
import CatchAll from "./page";

describe("catch-all", () => {
  it("triggers notFound", () => {
    expect(() => CatchAll()).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });
});
