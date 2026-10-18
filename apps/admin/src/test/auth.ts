import type { Admin } from "@/lib/auth";

/**
 * Stand-in for `@/lib/auth` for page/component tests (the real provider is covered by lib/auth.test.tsx):
 *
 *   vi.mock("@/lib/auth", async () => (await import("@/test/auth")).authModule);
 *   setAdmin("support");
 */
export const state: { admin: Admin | null } = { admin: null };
export function makeAdmin(role: Admin["role"] = "owner", over: Partial<Admin> = {}): Admin {
  return { id: "a1", email: "root@example.com", role, totp_enabled: false, ...over } as Admin;
}
export function setAdmin(role: Admin["role"] = "owner", over: Partial<Admin> = {}) {
  state.admin = makeAdmin(role, over);
  return state.admin;
}
export const logout = { calls: 0 };
export const authModule = {
  useAdmin: () => {
    if (!state.admin) state.admin = makeAdmin();
    return state.admin;
  },
  useAuth: () => ({
    admin: state.admin ?? makeAdmin(),
    loading: false,
    error: null,
    login: async () => state.admin ?? makeAdmin(),
    logout: () => void logout.calls++,
    reload: () => {},
  }),
  AuthProvider: ({ children }: { children: unknown }) => children,
};
