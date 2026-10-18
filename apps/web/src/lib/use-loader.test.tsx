import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLoader } from "./use-loader";

describe("useLoader", () => {
  it("runs the loader on mount and again only when it changes", () => {
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ fn }) => useLoader(fn), { initialProps: { fn: a } });
    expect(a).toHaveBeenCalledTimes(1);
    rerender({ fn: a });
    expect(a).toHaveBeenCalledTimes(1);
    rerender({ fn: b });
    expect(b).toHaveBeenCalledTimes(1);
  });
});
