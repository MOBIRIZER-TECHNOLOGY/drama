"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useHref, useT } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { stripLang } from "@/lib/languages";
import { IconGift, IconGrid, IconHome, IconShorts, IconUser } from "./ui/icons";

/**
 * Primary navigation below `md`, where the header's inline nav is hidden.
 *
 * Without this the majority of the audience — Android phones at 360px — can reach Shorts, Browse, Rewards and
 * their account only by guessing a URL. It is fixed rather than sticky so it survives the shorts feed's own
 * full-height scroller, and the body reserves its height through `--k-bottom-nav` so nothing is trapped
 * underneath it. Hidden on the shorts route, which is an immersive surface with its own chrome.
 */
export function BottomNav() {
  const pathname = usePathname();
  const t = useT();
  const href = useHref();
  const { status, openAuth } = useAuth();
  const current = stripLang(pathname);

  if (current === "/shorts") return null;

  const tabs = [
    { to: "/", label: t("nav.home", "Home"), Icon: IconHome },
    { to: "/shorts", label: t("nav.shorts", "Shorts"), Icon: IconShorts },
    { to: "/series", label: t("nav.browse", "Browse"), Icon: IconGrid },
    { to: "/rewards", label: t("nav.rewards", "Rewards"), Icon: IconGift },
  ];

  return (
    <nav
      aria-label={t("nav.primary", "Primary")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ground/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {tabs.map(({ to, label, Icon }) => {
          const active = current === to;
          return (
            <li key={to} className="flex-1">
              <Link
                href={href(to)}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] ${
                  active ? "text-accent" : "text-ink2"
                }`}
              >
                <Icon size={22} filled={active} />
                {label}
              </Link>
            </li>
          );
        })}
        <li className="flex-1">
          {status === "authenticated" ? (
            <Link
              href={href("/profile")}
              aria-current={current === "/profile" ? "page" : undefined}
              className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] ${
                current === "/profile" ? "text-accent" : "text-ink2"
              }`}
            >
              <IconUser size={22} />
              {t("nav.me", "Me")}
            </Link>
          ) : (
            <button
              type="button"
              onClick={openAuth}
              className="flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 text-[11px] text-ink2"
            >
              <IconUser size={22} />
              {t("auth.sign_in", "Sign in")}
            </button>
          )}
        </li>
      </ul>
    </nav>
  );
}
