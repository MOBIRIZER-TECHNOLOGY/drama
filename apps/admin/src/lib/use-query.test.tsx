import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { useQuery } from "./use-query";

describe("useQuery", () => {
  it("loads data and settles", async () => {
    const fn = vi.fn().mockResolvedValue(["a"]);
    const { result } = renderHook(() => useQuery("k", fn));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(["a"]);
    expect(result.current.error).toBeUndefined();
  });

  it("surfaces a readable error", async () => {
    const { result } = renderHook(() => useQuery("k", () => Promise.reject(new ApiError("nope", 500))));
    await waitFor(() => expect(result.current.error).toBe("nope"));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("refetches when the key changes, keeping previous data while loading", async () => {
    let n = 0;
    const { result, rerender } = renderHook(({ k }) => useQuery(k, async () => ++n), { initialProps: { k: "a" } });
    await waitFor(() => expect(result.current.data).toBe(1));
    rerender({ k: "b" });
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe(1);
    await waitFor(() => expect(result.current.data).toBe(2));
    expect(result.current.loading).toBe(false);
  });

  it("keeps old data alongside the new error", async () => {
    let fail = false;
    const { result } = renderHook(() => useQuery("k", () => (fail ? Promise.reject(new Error("later")) : Promise.resolve(1))));
    await waitFor(() => expect(result.current.data).toBe(1));
    fail = true;
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.error).toBe("later"));
    expect(result.current.data).toBe(1);
  });

  it("uses the latest fn on refetch", async () => {
    const { result, rerender } = renderHook(({ v }) => useQuery("k", async () => v), { initialProps: { v: "old" } });
    await waitFor(() => expect(result.current.data).toBe("old"));
    rerender({ v: "new" });
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.data).toBe("new"));
  });

  it("setData accepts a value or an updater", async () => {
    const { result } = renderHook(() => useQuery("k", async () => 1));
    await waitFor(() => expect(result.current.data).toBe(1));
    act(() => result.current.setData(5));
    expect(result.current.data).toBe(5);
    act(() => result.current.setData((p) => (p ?? 0) + 1));
    expect(result.current.data).toBe(6);
  });

  it("drops results from a superseded request", async () => {
    const resolvers: Record<string, (v: string) => void> = {};
    const rejecters: Record<string, (e: Error) => void> = {};
    const { result, rerender, unmount } = renderHook(
      ({ k }) => useQuery(k, () => new Promise<string>((res, rej) => ((resolvers[k] = res), (rejecters[k] = rej)))),
      { initialProps: { k: "a" } },
    );
    rerender({ k: "b" });
    await act(async () => resolvers.b("B"));
    await act(async () => resolvers.a("A")); // stale
    expect(result.current.data).toBe("B");
    rerender({ k: "c" });
    await act(async () => rejecters.b(new Error("stale error")));
    rerender({ k: "d" });
    await act(async () => rejecters.c(new Error("stale error 2")));
    expect(result.current.error).toBeUndefined();
    unmount();
  });
});
