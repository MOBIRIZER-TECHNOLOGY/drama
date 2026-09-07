"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useApp, useHref, useT } from "@/lib/app-context";
import { clientApi } from "@/lib/client-api";
import { call, type ApiError } from "@/lib/errors";
import { useLoader } from "@/lib/use-loader";
import { formatDate } from "@/lib/format";
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

  const kinds: Record<LedgerRow["kind"], string> = {
    signup_bonus: t("ledger.signup_bonus", "Welcome bonus"),
    purchase: t("ledger.purchase", "Purchase"),
    unlock: t("ledger.unlock", "Episode unlock"),
    ad_unlock: t("ledger.ad_unlock", "Ad unlock"),
    checkin: t("ledger.checkin", "Daily check-in"),
    task: t("ledger.task", "Task reward"),
    referral: t("ledger.referral", "Referral"),
    admin_adjust: t("ledger.admin_adjust", "Adjustment"),
    refund: t("ledger.refund", "Refund"),
  };

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
        <div className="overflow-x-auto rounded-lg border border-line">
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
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="whitespace-nowrap px-4 py-3 text-ink2">{formatDate(r.created_at, lang)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink">{kinds[r.kind] ?? r.kind}</td>
                  <td className="max-w-[16rem] truncate px-4 py-3 text-muted">{r.note ?? (r.ref_type ? `${r.ref_type}` : "")}</td>
                  <td className={`whitespace-nowrap px-4 py-3 text-end font-medium tabular-nums ${r.delta >= 0 ? "text-success" : "text-danger"}`}>
                    <span className="inline-flex items-center gap-1">
                      {r.delta >= 0 ? "+" : ""}
                      {r.delta}
                      <IconCoin size={13} className="text-gold" />
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-end tabular-nums text-ink2">{r.balance_after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
