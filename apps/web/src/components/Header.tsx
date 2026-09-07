"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useApp, useHref, useT } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { formatCoins } from "@/lib/format";
import { stripLang } from "@/lib/languages";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { SearchBox } from "./SearchBox";
import { Button } from "./ui/Button";
import { IconClose, IconCoin, IconGift, IconList, IconLogout, IconSearch, IconUser, IconWallet } from "./ui/icons";

/** Keyed on the pathname so open menus/search close on navigation without an effect. */
export function Header() {
  const pathname = usePathname();
  return <HeaderInner key={pathname} pathname={pathname} />;
}

function HeaderInner({ pathname }: { pathname: string }) {
  const t = useT();
  const href = useHref();
  const { config, lang } = useApp();
  const { status, user, balance, openAuth, signOut } = useAuth();
  // The signup bonus exists in the ledger and was advertised nowhere. Naming it on the one control that
  // converts anonymous visitors is the cheapest place to spend it.
  const signupBonus = config?.rewards?.signup_bonus ?? 0;
  const [mobileSearch, setMobileSearch] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = stripLang(pathname);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const nav = [
    { to: "/", label: t("nav.home", "Home") },
    { to: "/shorts", label: t("nav.shorts", "Shorts") },
    { to: "/series", label: t("nav.browse", "Browse") },
    { to: "/rewards", label: t("nav.rewards", "Rewards") },
    { to: "/my-list", label: t("nav.my_list", "My List") },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-ground/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:h-16 sm:px-6 lg:px-8">
        <Link href={href("/")} className="font-display flex items-center gap-1 text-2xl font-bold tracking-tight text-ink" aria-label="Katha home">
          Katha<span className="text-accent">.</span>
        </Link>

        <nav className="ms-4 hidden items-center gap-1 md:flex" aria-label="Primary">
          {nav.map((n) => (
            <Link
              key={n.to}
              href={href(n.to)}
              aria-current={current === n.to ? "page" : undefined}
              className={`rounded-pill px-3 py-1.5 text-sm transition-colors ${current === n.to ? "bg-surface2 text-ink" : "text-ink2 hover:text-ink"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="mx-auto hidden w-full max-w-md sm:block">
          <SearchBox />
        </div>

        <div className="ms-auto flex items-center gap-2 sm:ms-0">
          <button
            type="button"
            onClick={() => setMobileSearch((v) => !v)}
            aria-label={t("search.label", "Search")}
            aria-expanded={mobileSearch}
            className="rounded-pill p-2 text-ink2 hover:bg-surface2 sm:hidden"
          >
            {mobileSearch ? <IconClose /> : <IconSearch />}
          </button>

          <div className="hidden sm:block">
            <Suspense fallback={null}>
              <LanguageSwitcher compact />
            </Suspense>
          </div>

          {status === "loading" ? (
            <div className="k-skeleton h-9 w-20 rounded-pill" />
          ) : status === "authenticated" && user ? (
            <div ref={menuRef} className="relative flex items-center gap-2">
              <Link
                href={href("/wallet")}
                className="flex items-center gap-1 rounded-pill border border-gold/40 bg-surface px-2.5 py-1.5 text-sm font-medium tabular-nums text-gold hover:bg-surface2"
                aria-label={t("wallet.balance", "Coin balance")}
              >
                <IconCoin size={16} />
                {/* Keyed on the value so the number visibly ticks when it changes. Spending and earning were a
                    hard swap, which is the single most important feedback moment in a coin economy. */}
                <span key={balance} className="k-bump inline-block">
                  {formatCoins(balance, lang)}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="true"
                aria-expanded={menuOpen}
                aria-controls="account-menu"
                aria-label={t("nav.account", "Account")}
                className="relative h-9 w-9 overflow-hidden rounded-pill border border-line bg-surface2 text-ink2 hover:border-muted/60"
              >
                {user.avatar_url ? (
                  <Image src={user.avatar_url} alt="" fill sizes="36px" unoptimized className="object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center font-display text-sm font-semibold uppercase">
                    {(user.display_name || user.email || "?").slice(0, 1)}
                  </span>
                )}
              </button>
              {menuOpen && (
                <nav
                  id="account-menu"
                  aria-label={t("nav.account", "Account")}
                  className="absolute end-0 top-full mt-2 w-56 overflow-hidden rounded-md border border-line bg-surface py-1 text-sm"
                >
                  <div className="border-b border-line px-3 py-2">
                    <p className="truncate font-medium text-ink">{user.display_name || t("profile.anonymous", "Katha viewer")}</p>
                    <p className="truncate text-xs text-muted">{user.email || user.phone || user.public_id}</p>
                  </div>
                  <ul>
                    <MenuLink href={href("/profile")} icon={<IconUser size={16} />} label={t("nav.profile", "Profile")} />
                    <MenuLink href={href("/wallet")} icon={<IconWallet size={16} />} label={t("nav.wallet", "Wallet")} />
                    <MenuLink href={href("/rewards")} icon={<IconGift size={16} />} label={t("nav.rewards", "Rewards")} />
                    <MenuLink href={href("/my-list")} icon={<IconList size={16} />} label={t("nav.my_list", "My List")} />
                  </ul>
                  <div className="border-t border-line px-3 py-2 sm:hidden">
                    <Suspense fallback={null}>
                      <LanguageSwitcher />
                    </Suspense>
                  </div>
                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-start text-ink2 hover:bg-surface2 hover:text-ink"
                  >
                    <IconLogout size={16} />
                    {t("auth.sign_out", "Sign out")}
                  </button>
                </nav>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="sm:hidden">
                <Suspense fallback={null}>
                  <LanguageSwitcher compact />
                </Suspense>
              </div>
              <Button onClick={openAuth}>
                {signupBonus > 0
                  ? t("auth.sign_up_bonus", "Get {n} free coins", { n: signupBonus })
                  : t("auth.sign_up", "Sign up free")}
              </Button>
            </div>
          )}
        </div>
      </div>
      {mobileSearch && (
        <div className="border-t border-line px-4 py-2 sm:hidden">
          <SearchBox autoFocus onNavigate={() => setMobileSearch(false)} />
        </div>
      )}
    </header>
  );
}

function MenuLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-2 px-3 py-2 text-ink2 hover:bg-surface2 hover:text-ink">
        {icon}
        {label}
      </Link>
    </li>
  );
}
