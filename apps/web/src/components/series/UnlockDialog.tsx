"use client";

import Image from "next/image";
import Link from "next/link";
import { useApp, useHref, useT } from "@/lib/app-context";
import type { EpisodeOut } from "@/lib/types";
import { Button, buttonClass } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { IconCheck, IconCoin, IconLock, IconStar } from "../ui/icons";

export type UnlockStatus =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "bundle-busy" }
  | { kind: "insufficient"; message: string }
  | { kind: "sequential"; message: string }
  | { kind: "error"; message: string };

/** What "unlock everything left" costs, from GET /v1/series/{id}/bundle. */
export type BundleQuote = {
  episode_count: number;
  list_price: number;
  price: number;
  discount_pct: number;
  saving: number;
  affordable: boolean;
};

export function UnlockDialog({
  episode,
  balance,
  status,
  bundle,
  episodeCount,
  seriesSlug,
  onClose,
  onUnlock,
  onUnlockBundle,
}: {
  episode: EpisodeOut | null;
  balance: number;
  status: UnlockStatus;
  bundle: BundleQuote | null;
  episodeCount: number;
  seriesSlug: string;
  onClose: () => void;
  onUnlock: (method: "coins" | "ad") => void;
  onUnlockBundle: () => void;
}) {
  const t = useT();
  const href = useHref();
  const { config } = useApp();
  const price = episode?.price ?? 0;
  const canAfford = balance >= price;
  const rewardedAds = config?.flags?.rewarded_ads === true;
  const busy = status.kind === "busy" || status.kind === "bundle-busy";

  // Coming back matters more than getting there. Without `next` the viewer paid, landed on the wallet, and had
  // no route back to the episode they wanted — the single largest conversion leak in the app.
  const topUpHref = episode
    ? `${href("/wallet")}?next=${encodeURIComponent(`/series/${seriesSlug}?ep=${episode.number}`)}&need=${Math.max(0, price - balance)}`
    : href("/wallet");

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
          {/* Show the thing being sold. A paywall with no image is a receipt; competitors put the cliffhanger here. */}
          <div className="relative aspect-video overflow-hidden rounded-md border border-line bg-surface2">
            {episode.thumbnail_url ? (
              <Image
                src={episode.thumbnail_url}
                alt=""
                fill
                sizes="420px"
                unoptimized
                className="scale-105 object-cover blur-[6px]"
              />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-ground/90 to-ground/40" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center">
              <IconLock size={26} className="text-gold" />
              {episode.title && <p className="line-clamp-1 text-sm font-medium text-ink">{episode.title}</p>}
              {episodeCount > 0 && (
                <p className="text-xs text-muted">
                  {t("unlock.position", "Episode {n} of {total}", { n: episode.number, total: episodeCount })}
                </p>
              )}
            </div>
          </div>

          {(status.kind === "insufficient" || (!canAfford && status.kind === "idle")) && (
            <p className="text-sm text-warning">
              {status.kind === "insufficient"
                ? status.message
                : t("unlock.insufficient", "You need {n} more coins.", { n: price - balance })}
            </p>
          )}
          {(status.kind === "sequential" || status.kind === "error") && (
            <p role="alert" className="text-sm text-danger">
              {status.message}
            </p>
          )}

          {canAfford && status.kind !== "insufficient" ? (
            <Button
              variant="gold"
              size="lg"
              loading={status.kind === "busy"}
              disabled={busy}
              onClick={() => onUnlock("coins")}
              className="w-full flex-col !h-auto py-2.5"
            >
              <span className="inline-flex items-center gap-1.5">
                <IconCoin size={18} />
                {t("unlock.with_coins", "Unlock for {price} coins", { price })}
              </span>
              {/* The balance belongs inside the CTA: affordability should take no eye movement to judge. */}
              <span className="text-[11px] font-normal opacity-80">
                {t("unlock.balance_after", "Balance {n} → {after}", { n: balance, after: balance - price })}
              </span>
            </Button>
          ) : (
            <Link href={topUpHref} className={buttonClass("gold", "lg", "w-full")} onClick={onClose}>
              <IconCoin size={18} />
              {t("unlock.get_coins", "Get coins")}
            </Link>
          )}

          {/* The bundle is the highest-ARPU control in this category and the paywall had no equivalent. */}
          {bundle && bundle.episode_count > 1 && (
            <div className="rounded-md border border-gold/40 bg-gold/5 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-ink">
                  {t("unlock.bundle_title", "Unlock all {n} remaining episodes", { n: bundle.episode_count })}
                </p>
                {bundle.discount_pct > 0 && (
                  <span className="rounded-pill bg-gold px-2 py-0.5 text-[11px] font-semibold text-accent-ink">
                    {t("unlock.bundle_save", "Save {pct}%", { pct: bundle.discount_pct })}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">
                <span className="line-through">{bundle.list_price}</span>{" "}
                <span className="font-semibold text-gold">{bundle.price}</span>{" "}
                {t("unlock.bundle_coins", "coins · never see this screen again")}
              </p>
              {bundle.affordable ? (
                <Button
                  variant="secondary"
                  loading={status.kind === "bundle-busy"}
                  disabled={busy}
                  onClick={onUnlockBundle}
                  className="mt-2.5 w-full"
                >
                  <IconCheck size={16} />
                  {t("unlock.bundle_cta", "Unlock the whole series")}
                </Button>
              ) : (
                <Link
                  href={`${href("/wallet")}?next=${encodeURIComponent(`/series/${seriesSlug}?ep=${episode.number}`)}&need=${bundle.price}`}
                  className={buttonClass("secondary", "md", "mt-2.5 w-full")}
                  onClick={onClose}
                >
                  {t("unlock.bundle_topup", "Get {n} coins for the bundle", { n: bundle.price })}
                </Link>
              )}
            </div>
          )}

          {rewardedAds && (
            <Button variant="secondary" size="lg" disabled={busy} onClick={() => onUnlock("ad")} className="w-full">
              {t("unlock.watch_ad", "Watch an ad to unlock")}
            </Button>
          )}

          {/* VIP was priced in the wallet and mentioned nowhere near the moment of intent. */}
          <Link
            href={href("/wallet")}
            onClick={onClose}
            className="flex items-center justify-center gap-1.5 text-xs text-muted transition-colors hover:text-ink2"
          >
            <IconStar size={13} className="text-gold" />
            {t("unlock.vip_hint", "Or go VIP and watch everything")}
          </Link>

          <p className="text-center text-xs text-muted">
            {t("unlock.sequential_hint", "Episodes unlock in order and stay unlocked forever.")}
          </p>
        </div>
      )}
    </Dialog>
  );
}
