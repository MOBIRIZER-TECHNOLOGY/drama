/**
 * Capture and hold an invite code across the sign-up journey.
 *
 * A referral link lands on the home page, but the account is created minutes later, possibly after a Google
 * redirect that replaces the whole document. So the code is read from the URL once and parked in
 * `sessionStorage`, then attached to whichever `/auth/exchange` call eventually happens and cleared. Without
 * this the invite link resolves to an ordinary visit and the loop pays nobody.
 *
 * `sessionStorage` rather than `localStorage` on purpose: an invite should not still be attached to an account
 * created on the same device three weeks later.
 */

const KEY = "katha.ref";
// Referral codes are 8 characters from a Crockford-style alphabet (no I, O, 0, 1); accept a little slack.
const SHAPE = /^[A-Z0-9]{4,16}$/;

function normalise(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return SHAPE.test(code) ? code : null;
}

/** Read `?ref=` (or `?referral=`) from the current URL and remember it. Safe to call on every navigation. */
export function captureReferral(search: string): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(search);
  const code = normalise(params.get("ref") ?? params.get("referral"));
  if (!code) return;
  try {
    // First link wins: if someone already arrived through an invite, a later one does not overwrite it.
    if (!window.sessionStorage.getItem(KEY)) window.sessionStorage.setItem(KEY, code);
  } catch {
    // Private mode or blocked storage: the visit simply is not attributed.
  }
}

export function pendingReferral(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return normalise(window.sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function clearReferral(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
