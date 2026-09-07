"use client";

import Link from "next/link";
import { useApp, useHref, useT } from "@/lib/app-context";
import type { EpisodeOut } from "@/lib/types";
import { Button, buttonClass } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { IconCoin, IconLock } from "../ui/icons";

export type UnlockStatus =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "insufficient"; message: string }
  | { kind: "sequential"; message: string }
  | { kind: "error"; message: string };

export function UnlockDialog({
  episode,
  balance,
  status,
  onClose,
  onUnlock,
}: {
  episode: EpisodeOut | null;
  balance: number;
  status: UnlockStatus;
  onClose: () => void;
  onUnlock: (method: "coins" | "ad") => void;
}) {
  const t = useT();
  const href = useHref();
  const { config } = useApp();
  const price = episode?.price ?? 0;
  const canAfford = balance >= price;
  const rewardedAds = config?.flags?.rewarded_ads === true;

  return (
    <Dialog
      open={!!episode}
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          <IconLock size={18} className="text-gold" />
          {t("unlock.title", "Unlock episode {n}", { n: episode?.number ?? "" })}
        </span>
      }
      size="sm"
      closeLabel={t("common.close", "Close")}
    >
      {episode && (
        <div className="flex flex-col gap-4">
          {episode.title && <p className="text-sm text-ink2">{episode.title}</p>}

          <div className="flex items-center justify-between rounded-md border border-line bg-ground px-4 py-3 text-sm">
            <span className="text-muted">{t("unlock.price", "Price")}</span>
            <span className="inline-flex items-center gap-1 font-semibold text-gold">
              <IconCoin size={16} />
              {price}
            </span>
          </div>
          <div className="flex items-center justify-between rounded-md border border-line bg-ground px-4 py-3 text-sm">
            <span className="text-muted">{t("wallet.balance", "Your balance")}</span>
            <span className={`inline-flex items-center gap-1 font-semibold ${canAfford ? "text-ink" : "text-danger"}`}>
              <IconCoin size={16} className="text-gold" />
              {balance}
            </span>
          </div>

          {(status.kind === "insufficient" || (!canAfford && status.kind === "idle")) && (
            <p className="text-sm text-warning">
              {status.kind === "insufficient" ? status.message : t("unlock.insufficient", "You need {n} more coins.", { n: price - balance })}
            </p>
          )}
          {(status.kind === "sequential" || status.kind === "error") && (
            <p role="alert" className="text-sm text-danger">
              {status.message}
            </p>
          )}

          {canAfford && status.kind !== "insufficient" ? (
            <Button variant="gold" size="lg" loading={status.kind === "busy"} onClick={() => onUnlock("coins")} className="w-full">
              <IconCoin size={18} />
              {t("unlock.with_coins", "Unlock for {price} coins", { price })}
            </Button>
          ) : (
            <Link href={href("/wallet")} className={buttonClass("gold", "lg", "w-full")} onClick={onClose}>
              <IconCoin size={18} />
              {t("unlock.get_coins", "Get coins")}
            </Link>
          )}

          {rewardedAds && (
            <Button variant="secondary" size="lg" disabled={status.kind === "busy"} onClick={() => onUnlock("ad")} className="w-full">
              {t("unlock.watch_ad", "Watch an ad to unlock")}
            </Button>
          )}

          <p className="text-center text-xs text-muted">{t("unlock.sequential_hint", "Episodes unlock in order and stay unlocked forever.")}</p>
        </div>
      )}
    </Dialog>
  );
}
