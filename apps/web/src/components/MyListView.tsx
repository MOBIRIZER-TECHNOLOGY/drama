"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useApp, useHref, useT } from "@/lib/app-context";
import { clientApi } from "@/lib/client-api";
import { call, type ApiError } from "@/lib/errors";
import { useLoader } from "@/lib/use-loader";
import { formatDuration, formatRelative } from "@/lib/format";
import { useToast } from "@/lib/toast";
import type { MyListOut } from "@/lib/types";
import { PageTitle, RequireAuth } from "./RequireAuth";
import { SeriesCard } from "./SeriesCard";
import { Button, buttonClass } from "./ui/Button";
import { EmptyState, ErrorState, Skeleton } from "./ui/states";
import { IconPlay, IconStar, IconTrash } from "./ui/icons";

export function MyListView() {
  return (
    <RequireAuth>
      <MyListInner />
    </RequireAuth>
  );
}

function MyListInner() {
  const t = useT();
  const href = useHref();
  const toast = useToast();
  const { lang } = useApp();
  const [data, setData] = useState<MyListOut | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await call(() => clientApi.GET("/v1/me/list", { params: { query: { lang } } }));
    if (res.error) return setError(res.error);
    setError(null);
    setData(res.data);
  }, [lang]);

  useLoader(load);

  const remove = async (seriesId: string | null) => {
    setBusy(seriesId ?? "all");
    const { error } = await call(() =>
      clientApi.DELETE("/v1/me/history", { params: { query: seriesId ? { series_id: seriesId } : {} } }),
    );
    setBusy(null);
    if (error) return toast(error.message, "error");
    setData((d) => (d ? { ...d, history: seriesId ? d.history.filter((h) => h.series.id !== seriesId) : [] } : d));
  };

  if (error) return <ErrorState error={error} onRetry={load} />;

  return (
    <div>
      <PageTitle>{t("my_list.title", "My List")}</PageTitle>

      <section aria-labelledby="cw-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="cw-heading" className="font-display text-lg font-semibold text-ink">
            {t("my_list.continue", "Continue watching")}
          </h2>
          {data && data.history.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => remove(null)} loading={busy === "all"}>
              <IconTrash size={14} />
              {t("my_list.clear_history", "Clear history")}
            </Button>
          )}
        </div>
        {!data ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : data.history.length === 0 ? (
          <EmptyState
            icon={<IconPlay size={28} />}
            title={t("my_list.no_history", "Nothing in progress")}
            message={t("my_list.no_history_hint", "Episodes you start will show up here so you can pick up where you left off.")}
            action={
              <Link href={href("/")} className={buttonClass("secondary", "sm")}>
                {t("my_list.browse", "Browse dramas")}
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {data.history.map((h) => {
              const pct = h.duration_sec ? Math.min(100, Math.round((h.position_sec / h.duration_sec) * 100)) : h.completed ? 100 : 0;
              const nextNumber = h.completed ? h.episode_number + 1 : h.episode_number;
              const target = href(`/series/${h.series.slug}?ep=${Math.min(nextNumber, h.series.episode_count || nextNumber)}`);
              return (
                <li key={h.episode_id} className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3">
                  <Link href={target} className="relative h-20 w-[45px] shrink-0 overflow-hidden rounded-sm bg-surface2">
                    {h.series.cover_url && <Image src={h.series.cover_url} alt="" fill sizes="45px" className="object-cover" />}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link href={target} className="line-clamp-1 font-medium text-ink hover:text-accent">
                      {h.series.title}
                    </Link>
                    <p className="text-sm text-muted">
                      {t("series.episode", "Episode")} {h.episode_number}
                      {h.completed ? ` · ${t("my_list.completed", "Completed")}` : h.duration_sec ? ` · ${formatDuration(h.position_sec)} / ${formatDuration(h.duration_sec)}` : ""}
                      <span className="hidden sm:inline"> · {formatRelative(h.updated_at, lang)}</span>
                    </p>
                    <div className="mt-2 h-1 overflow-hidden rounded-pill bg-surface2" aria-hidden>
                      <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <Link href={target} className={buttonClass("primary", "sm", "hidden sm:inline-flex")}>
                    <IconPlay size={14} />
                    {h.completed ? t("my_list.next_episode", "Next") : t("my_list.resume", "Resume")}
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove(h.series.id)}
                    disabled={busy === h.series.id}
                    aria-label={t("my_list.remove", "Remove from history")}
                    className="rounded-pill p-2 text-muted hover:bg-surface2 hover:text-danger disabled:opacity-50"
                  >
                    <IconTrash size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="fav-heading" className="mt-10">
        <h2 id="fav-heading" className="font-display mb-3 text-lg font-semibold text-ink">
          {t("my_list.favourites", "Favourites")}
        </h2>
        {!data ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[9/16] w-full" />
            ))}
          </div>
        ) : data.favorites.length === 0 ? (
          <EmptyState
            icon={<IconStar size={28} />}
            title={t("my_list.no_favourites", "No favourites yet")}
            message={t("my_list.no_favourites_hint", "Tap the star on any drama to keep it here.")}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {data.favorites.map((s) => (
              <SeriesCard key={s.id} series={s} lang={lang} className="w-full sm:w-full md:w-full" episodesLabel={t("series.eps", "eps")} freeLabel={t("series.free", "Free")} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
