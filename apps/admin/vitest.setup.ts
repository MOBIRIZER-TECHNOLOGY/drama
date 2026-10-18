import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { fetchStub, mockApi } from "@/test/api";
import { nav, routerApi } from "@/test/navigation";

// openapi-fetch captures `globalThis.fetch` when `lib/api.ts` creates the client, so this must happen at setup time.
globalThis.fetch = fetchStub as typeof fetch;

// Newer Node ships its own experimental `localStorage` global that shadows jsdom's and has no usable methods
// without a --localstorage-file. Give tests a plain in-memory Storage so the app code sees real behaviour.
if (typeof window !== "undefined" && typeof window.localStorage?.getItem !== "function") {
  const makeStorage = (): Storage => {
    let data = new Map<string, string>();
    return {
      get length() {
        return data.size;
      },
      clear: () => void (data = new Map()),
      getItem: (k: string) => data.get(k) ?? null,
      key: (i: number) => [...data.keys()][i] ?? null,
      removeItem: (k: string) => void data.delete(k),
      setItem: (k: string, v: string) => void data.set(k, String(v)),
    };
  };
  for (const name of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(window, name, { value: makeStorage(), configurable: true });
    Object.defineProperty(globalThis, name, { value: window[name], configurable: true });
  }
}

vi.mock("next/navigation", () => ({
  useRouter: () => routerApi,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useParams: () => nav.params,
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

beforeEach(() => {
  mockApi.reset();
  nav.reset();
  try {
    window.localStorage.clear();
  } catch {
    /* node environment */
  }
});

afterEach(() => {
  cleanup();
});
