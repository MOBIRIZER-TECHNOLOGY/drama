"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useApp, useHref, useT } from "@/lib/app-context";
import { clientApi } from "@/lib/client-api";
import { downloadCsv } from "@/lib/csv";
import { call, type ApiError } from "@/lib/errors";
import { useLoader } from "@/lib/use-loader";
import { formatCoins, formatDate } from "@/lib/format";
import type { LedgerRow } from "@/lib/types";
import { PageTitle, RequireAuth } from "../RequireAuth";
import { Button, buttonClass } from "../ui/Button";
import { EmptyState, ErrorState, Skeleton } from "../ui/states";
import { IconChevronLeft, IconCoin } from "../ui/icons";

const PAGE = 50;

export function LedgerView() {
  return (
    <RequireAuth>
      <LedgerInner />
    </RequireAuth>
  );
}

function LedgerInner() {
  const t = useT();
  const href = useHref();
  const { lang } = useApp();
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");

  // Memoised because the CSV export depends on it; a fresh object each render would rebuild that callback too.
  const kinds: Record<LedgerRow["kind"], string> = useMemo(
    () => ({
      signup_bonus: t("ledger.signup_bonus", "Welcome bonus"),
      purchase: t("ledger.purchase", "Top-up"),
      unlock: t("ledger.unlock", "Episode unlock"),
      ad_unlock: t("ledger.ad_unlock", "Ad unlock"),
      checkin: t("ledger.checkin", "Daily check-in"),
      task: t("ledger.task", "Task reward"),
      referral: t("ledger.referral", "Referral"),
      admin_adjust: t("ledger.admin_adjust", "Adjustment"),
      refund: t("ledger.refund", "Refund"),
    }),
    [t],
  );

  const load = useCallback(async (before?: string) => {
    const { data, error } = await call(() => clientApi.GET("/v1/wallet/ledger", { params: { query: { limit: PAGE, before } } }));
    if (error) {
      if (!before) setError(error);
      return;
    }
    if (!before) setError(null);
    setRows((prev) => (before && prev ? [...prev, ...data] : data));
    setMore(data.length === PAGE);
  }, []);

  useLoader(load);


  const loadMore = async () => {
    const last = rows?.[rows.length - 1];
    if (!last) return;
    setLoadingMore(true);
    await load(last.created_at);
    setLoadingMore(false);
  };

  const visible = useMemo(
    () => (rows ?? []).filter((r) => (filter === "all" ? true : filter === "in" ? r.delta >= 0 : r.delta < 0)),
    [rows, filter],
  );

  /** Rows grouped under a month heading. Fifty undifferentiated rows is a bank statement, not a wallet. */
  const months = useMemo(() => {
    const out: { key: string; label: string; rows: LedgerRow[] }[] = [];
    for (const row of visible) {
      const date = new Date(row.created_at);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      let group = out[out.length - 1];
      if (!group || group.key !== key) {
        let label = key;
        try {
          label = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(date);
        } catch {
          /* an unsupported locale falls back to the raw key */
        }
        group = { key, label, rows: [] };
        out.push(group);
      }
      group.rows.push(row);
    }
    return out;
  }, [visible, lang]);

  /** Earned and spent across what is loaded, so the page is worth opening rather than only worth auditing. */
  const summary = useMemo(() => {
    let earned = 0;
    let spent = 0;
    for (const r of rows ?? []) {
      if (r.delta >= 0) earned += r.delta;
      else spent -= r.delta;
    }
    return { earned, spent };
  }, [rows]);

  /**
   * The rows on screen, as a file.
   *
   * A viewer disputing a balance is asked to describe it, and nobody can describe a scrolling list. Exports
   * exactly what the filter above says is showing, with the human label rather than the wire value.
   */
  const exportCsv = useCallback(() => {
    downloadCsv(
      `katha-coins-${new Date().toISOString().slice(0, 10)}`,
      [
        { key: "created_at", label: t("ledger.col_date", "Date") },
        { key: "kind", label: t("ledger.col_type", "Type") },
        { key: "delta", label: t("ledger.col_change", "Change") },
        { key: "balance_after", label: t("ledger.col_balance", "Balance") },
        { key: "note", label: t("ledger.col_note", "Note") },
      ],
      visible.map((r) => ({ ...r, kind: kinds[r.kind] ?? r.kind })),
    );
  }, [visible, kinds, t]);

  return (
    <div>
      <PageTitle
        sub={t("ledger.subtitle", "Every coin in and out of your wallet.")}
        aside={
          <Link href={href("/wallet")} className={buttonClass("ghost", "sm")}>
            <IconChevronLeft size={16} className="rtl:rotate-180" />
            {t("wallet.title", "Wallet")}
          </Link>
        }
      >
        {t("ledger.title", "Transaction history")}
      </PageTitle>

      {rows && rows.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {t("ledger.summary", "Earned {earned} · Spent {spent}", {
              earned: formatCoins(summary.earned, lang),
              spent: formatCoins(summary.spent, lang),
            })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-pill border border-line bg-surface p-1 text-sm">
            {(["all", "in", "out"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
                className={`rounded-pill px-3 py-1 transition-colors ${filter === key ? "bg-surface2 text-ink" : "text-muted hover:text-ink"}`}
              >
                {key === "all"
                  ? t("ledger.filter_all", "All")
                  : key === "in"
                    ? t("ledger.filter_in", "Earned")
                    : t("ledger.filter_out", "Spent")}
              </button>
            ))}
          </div>
          {/* Someone disputing a balance is asked to describe it, which nobody can do from a scrolling list. */}
          <Button variant="ghost" size="sm" onClick={exportCsv}>
            {t("ledger.export", "Export CSV")}
          </Button>
          </div>
        </div>
      )}

      {error ? (
        <ErrorState error={error} onRetry={() => load()} />
      ) : !rows ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={t("ledger.empty", "No transactions yet")} message={t("ledger.empty_hint", "Buy a pack or claim your daily check-in to get started.")} />
      ) : (
        <>
          <ul className="flex flex-col gap-3 sm:hidden">
            {months.map((group) => (
              <li key={group.key}>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">{group.label}</p>
                <ul className="overflow-hidden rounded-lg border border-line">
                  {group.rows.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink">{kinds[r.kind] ?? r.kind}</p>
                        <p className="truncate text-xs text-muted">
                          {formatDate(r.created_at, lang)}
                          {r.note ? ` · ${r.note}` : ""}
                        </p>
                      </div>
                      <div className="text-end">
                        <p className={`text-sm font-medium tabular-nums ${r.delta >= 0 ? "text-success" : "text-ink"}`}>
                          {r.delta >= 0 ? "+" : ""}
                          {formatCoins(r.delta, lang)}
                        </p>
                        <p className="text-xs tabular-nums text-muted">{formatCoins(r.balance_after, lang)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-lg border border-line sm:block">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{t("ledger.date", "Date")}</th>
                <th className="px-4 py-3 text-start font-medium">{t("ledger.kind", "Type")}</th>
                <th className="px-4 py-3 text-start font-medium">{t("ledger.note", "Note")}</th>
                <th className="px-4 py-3 text-end font-medium">{t("ledger.delta", "Coins")}</th>
                <th className="px-4 py-3 text-end font-medium">{t("ledger.balance", "Balance")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="whitespace-nowrap px-4 py-3 text-ink2">{formatDate(r.created_at, lang)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink">{kinds[r.kind] ?? r.kind}</td>
                  <td className="max-w-[16rem] truncate px-4 py-3 text-muted">{r.note ?? (r.ref_type ? `${r.ref_type}` : "")}</td>
                  {/* A spend is not an error. `danger` is a pale pink that reads as something having gone wrong;
                      muted ink is what a debit should look like, with success reserved for credits. */}
                  <td className={`whitespace-nowrap px-4 py-3 text-end font-medium tabular-nums ${r.delta >= 0 ? "text-success" : "text-ink"}`}>
                    <span className="inline-flex items-center gap-1">
                      {r.delta >= 0 ? "+" : ""}
                      {formatCoins(r.delta, lang)}
                      <IconCoin size={13} className="text-gold" />
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-end tabular-nums text-ink2">
                    {formatCoins(r.balance_after, lang)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
      {more && rows && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={loadMore} loading={loadingMore}>
            {t("common.load_more", "Load more")}
          </Button>
        </div>
      )}
    </div>
  );
}
