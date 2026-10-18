import { vi } from "vitest";

/**
 * Controllable stand-in for `next/navigation`. Use from a test file with:
 *   vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
 * then mutate `nav` to set the pathname / query and assert on `nav.router.*`.
 */
export const nav = {
  pathname: "/",
  search: new URLSearchParams(),
  params: {} as Record<string, string>,
  router: {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  },
};

export function resetNav(pathname = "/", search = "") {
  nav.pathname = pathname;
  nav.search = new URLSearchParams(search);
  nav.params = {};
  for (const fn of Object.values(nav.router)) fn.mockReset();
}

export const useRouter = () => nav.router;
export const usePathname = () => nav.pathname;
export const useSearchParams = () => nav.search;
export const useParams = () => nav.params;
export const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
export const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
export const permanentRedirect = redirect;
