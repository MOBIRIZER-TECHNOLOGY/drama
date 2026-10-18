/**
 * State behind the global `next/navigation` mock (registered in `vitest.setup.ts`). Tests set the current
 * location with `nav.set({ pathname, search, params })` and assert on `nav.router.*` calls.
 */
export const router = {
  push: [] as string[],
  replace: [] as string[],
  back: 0,
  refresh: 0,
  prefetch: [] as string[],
};
export const nav = {
  pathname: "/dashboard",
  search: "",
  params: {} as Record<string, string>,
  set(v: { pathname?: string; search?: string; params?: Record<string, string> }) {
    if (v.pathname !== undefined) nav.pathname = v.pathname;
    if (v.search !== undefined) nav.search = v.search;
    if (v.params !== undefined) nav.params = v.params;
  },
  reset() {
    nav.pathname = "/dashboard";
    nav.search = "";
    nav.params = {};
    router.push = [];
    router.replace = [];
    router.back = 0;
    router.refresh = 0;
    router.prefetch = [];
  },
  router,
};
export const routerApi = {
  push: (href: string) => void router.push.push(href),
  replace: (href: string) => void router.replace.push(href),
  back: () => void router.back++,
  forward: () => {},
  refresh: () => void router.refresh++,
  prefetch: (href: string) => void router.prefetch.push(href),
};
