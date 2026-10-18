import { vi } from "vitest";
import type { ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth-context";

/**
 * Controllable stand-in for `@/lib/auth-context`. Use with:
 *   vi.mock("@/lib/auth-context", () => import("@/test-utils/auth-context"));
 * and mutate `auth` (or call `setAuth`) before rendering.
 */
export const REDIRECT_FLAG = "katha.auth_redirect";

const base = (): AuthContextValue => ({
  status: "anonymous",
  user: null,
  balance: 0,
  firebaseConfigured: true,
  dialogOpen: false,
  openAuth: vi.fn(),
  closeAuth: vi.fn(),
  exchange: vi.fn(async () => null),
  signOut: vi.fn(async () => {}),
  refreshUser: vi.fn(async () => {}),
  setBalance: vi.fn(),
});

export const auth: AuthContextValue = base();

export function setAuth(patch: Partial<AuthContextValue> = {}) {
  Object.assign(auth, base(), patch);
  return auth;
}

export const useAuth = () => auth;
export const AuthProvider = ({ children }: { children: ReactNode }) => <>{children}</>;

export const aUser = {
  id: "u1",
  email: "ann@example.com",
  display_name: "Ann",
  coin_balance: 120,
} as unknown as NonNullable<AuthContextValue["user"]>;
