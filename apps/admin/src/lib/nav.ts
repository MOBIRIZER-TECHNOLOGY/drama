import type { Schemas } from "./api";

export type Role = Schemas["AdminRole"];

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  roles: Role[];
  /** Sidebar group heading. Items with the same section render together, in NAV order. */
  section: string;
  /** Route exists and is role-gated, but is not listed in the sidebar (e.g. API not ready). */
  hidden?: boolean;
};

const ALL: Role[] = ["owner", "editor", "support", "finance"];
export const ROLES: readonly Role[] = ALL;

/** Sidebar sections. Owner sees everything; the others only what their API role can call. */
export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", roles: ALL, section: "Overview" },
  { href: "/dramas", label: "Dramas", icon: "film", roles: ["owner", "editor"], section: "Content" },
  { href: "/categories", label: "Categories", icon: "tag", roles: ["owner", "editor"], section: "Content" },
  { href: "/languages", label: "Languages & Translations", icon: "globe", roles: ["owner", "editor"], section: "Content" },
  { href: "/pages", label: "Pages", icon: "doc", roles: ["owner", "editor"], section: "Content" },
  { href: "/users", label: "Users", icon: "users", roles: ["owner", "support", "finance"], section: "Audience" },
  { href: "/purchases", label: "Purchases", icon: "receipt", roles: ["owner", "finance"], section: "Monetisation" },
  { href: "/packs", label: "Coin Packs", icon: "coins", roles: ["owner", "finance"], section: "Monetisation" },
  { href: "/rewards", label: "Rewards", icon: "gift", roles: ["owner", "finance"], section: "Monetisation" },
  { href: "/experiments", label: "Experiments", icon: "flask", roles: ["owner", "finance"], section: "Growth" },
  { href: "/flags", label: "Feature Flags", icon: "toggle", roles: ["owner", "finance"], section: "Growth" },
  { href: "/offers", label: "Offers & Coupons", icon: "ticket", roles: ["owner", "finance"], section: "Growth" },
  { href: "/ads", label: "Ad Placements", icon: "megaphone", roles: ["owner", "finance"], section: "Growth" },
  { href: "/moderation", label: "Moderation", icon: "eye", roles: ["owner", "editor", "support"], section: "Support" },
  { href: "/reports", label: "Reports", icon: "flag", roles: ["owner", "support"], section: "Support" },
  { href: "/inbox", label: "Inbox", icon: "inbox", roles: ["owner", "support"], section: "Support" },
  { href: "/settings", label: "Settings", icon: "settings", roles: ["owner", "finance"], section: "System" },
  { href: "/accounts", label: "Admin Accounts", icon: "shield", roles: ["owner"], section: "System" },
  // Owner-only: the log names admins and the accounts they acted on, which is more than support needs to see.
  { href: "/audit", label: "Audit Log", icon: "shield", roles: ["owner"], section: "System" },
];

/** Items listed in the sidebar for a role (hidden routes are omitted but still reachable). */
export function navFor(role: Role): NavItem[] {
  return NAV.filter((n) => n.roles.includes(role) && !n.hidden);
}

/** Sidebar items grouped by section, preserving NAV order. */
export function navSectionsFor(role: Role): { section: string; items: NavItem[] }[] {
  const out: { section: string; items: NavItem[] }[] = [];
  for (const item of navFor(role)) {
    const last = out[out.length - 1];
    if (last && last.section === item.section) last.items.push(item);
    else out.push({ section: item.section, items: [item] });
  }
  return out;
}

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ALL as string[]).includes(v);
}

/** Deny by default: only paths under a known section the role may use are allowed. */
export function canAccess(role: Role, pathname: string): boolean {
  const item = NAV.find((n) => pathname === n.href || pathname.startsWith(n.href + "/"));
  return item ? item.roles.includes(role) : false;
}
