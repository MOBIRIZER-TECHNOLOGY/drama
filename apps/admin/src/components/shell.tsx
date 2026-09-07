"use client";

import { CommandPalette } from "@/components/command-palette";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { canAccess, navSectionsFor } from "@/lib/nav";
import { Icon } from "./icons";
import { Button, LoadingState } from "./ui";

export function Shell({ children }: { children: ReactNode }) {
  const { admin, loading, error, logout, reload } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const allowed = admin ? canAccess(admin.role, pathname) : true;

  useEffect(() => {
    if (admin && !allowed) router.replace("/dashboard");
  }, [admin, allowed, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState label="Signing you in…" />
      </div>
    );
  }
  if (!admin) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 text-center">
          <p className="font-medium text-danger">Could not load your session</p>
          <p className="mt-1 text-sm text-muted">{error ?? "Unknown error"}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={reload}>Retry</Button>
            <Button variant="primary" onClick={logout}>
              Sign in again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const sections = navSectionsFor(admin.role);

  const nav = (
    <nav aria-label="Sections" className="flex flex-col gap-3 px-3">
      {sections.map((group) => (
        <div key={group.section}>
          <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{group.section}</p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active ? "bg-accent/10 text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  <Icon name={item.icon} size={17} className={active ? "text-accent" : "text-muted"} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto py-2">{nav}</div>
        <UserBox name={admin.display_name} role={admin.role} onLogout={logout} />
      </aside>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button aria-label="Close menu" className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface">
            <Brand />
            <div className="flex-1 overflow-y-auto py-2">{nav}</div>
            <UserBox name={admin.display_name} role={admin.role} onLogout={logout} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className="rounded-md p-1 text-ink-2 hover:bg-surface-2"
          >
            <Icon name="menu" />
          </button>
          <span className="font-display text-lg font-semibold">Katha Admin</span>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {allowed ? children : <LoadingState label="Redirecting…" />}
        </main>
      </div>

      {/* Ctrl/Cmd+K from anywhere in the console. */}
      <CommandPalette role={admin.role} />
    </div>
  );
}

function Brand() {
  return (
    <div className="flex h-14 items-center gap-2 border-b border-line px-5">
      <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-accent font-display text-sm font-bold text-white">
        K
      </span>
      <span className="font-display text-lg font-semibold">Katha Admin</span>
    </div>
  );
}

function UserBox({ name, role, onLogout }: { name: string; role: string; onLogout: () => void }) {
  return (
    <div className="flex items-center gap-3 border-t border-line px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-xs uppercase tracking-wide text-muted">{role}</p>
      </div>
      <button
        type="button"
        onClick={onLogout}
        aria-label="Sign out"
        title="Sign out"
        className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
      >
        <Icon name="logout" size={17} />
      </button>
    </div>
  );
}
