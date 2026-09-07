"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { useApp, useHref, useT } from "@/lib/app-context";
import { clientApi } from "@/lib/client-api";
import { call } from "@/lib/errors";
import type { SeriesCard } from "@/lib/types";
import { IconSearch, Spinner } from "./ui/icons";

type Result = { term: string; data: SeriesCard[] | null; error: string | null };

export function SearchBox({ autoFocus = false, onNavigate }: { autoFocus?: boolean; onNavigate?: () => void }) {
  const t = useT();
  const { lang } = useApp();
  const href = useHref();
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const term = q.trim();
  const active = term.length >= 2;
  // Results are keyed by the term they answer, so stale responses never show for a newer query.
  const fresh = result && result.term === term ? result : null;
  const loading = active && !fresh;

  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      const { data, error } = await call(() =>
        clientApi.GET("/v1/series", { params: { query: { q: term, lang, limit: 8 } }, signal: ctrl.signal }),
      );
      if (ctrl.signal.aborted) return;
      setResult(data ? { term, data, error: null } : { term, data: null, error: error.message });
    }, 250);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [term, active, lang]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const submit = () => {
    if (!term) return;
    track("search", { q: term, results: fresh?.data?.length ?? null, surface: "box" });
    setOpen(false);
    onNavigate?.();
    router.push(href(`/search?q=${encodeURIComponent(term)}`));
  };

  const showPanel = open && active;

  return (
    <div ref={boxRef} className="relative w-full">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="relative"
      >
        <IconSearch size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="search"
          role="combobox"
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={t("search.placeholder", "Search dramas")}
          aria-label={t("search.label", "Search")}
          aria-controls={listId}
          aria-expanded={showPanel}
          aria-autocomplete="list"
          autoComplete="off"
          className="h-9 w-full rounded-pill border border-line bg-surface ps-9 pe-8 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
        />
        {loading && <Spinner size={14} className="absolute end-3 top-1/2 -translate-y-1/2 text-muted" />}
      </form>
      {showPanel && (
        <div id={listId} className="absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-md border border-line bg-surface">
          {!fresh ? (
            <p className="px-3 py-3 text-sm text-muted">{t("common.loading", "Loading…")}</p>
          ) : fresh.error ? (
            <p className="px-3 py-3 text-sm text-danger">{fresh.error}</p>
          ) : fresh.data && fresh.data.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">{t("search.no_results", "No dramas match that.")}</p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto py-1">
              {(fresh.data ?? []).map((s) => (
                <li key={s.id}>
                  <Link
                    href={href(`/series/${s.slug}`)}
                    onClick={() => {
                      setOpen(false);
                      onNavigate?.();
                    }}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-surface2"
                  >
                    <span className="relative h-12 w-8 shrink-0 overflow-hidden rounded-sm bg-surface2">
                      {s.cover_url && <Image src={s.cover_url} alt="" fill sizes="32px" className="object-cover" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-sm text-ink">{s.title}</span>
                      <span className="line-clamp-1 text-xs text-muted">
                        {s.episode_count} {t("series.episodes", "episodes")}
                        {s.categories[0] ? ` · ${s.categories[0].name}` : ""}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
              <li className="border-t border-line">
                <button type="button" onClick={submit} className="w-full px-3 py-2 text-start text-sm text-accent hover:bg-surface2">
                  {t("search.see_all", "See all results for")} “{term}”
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
