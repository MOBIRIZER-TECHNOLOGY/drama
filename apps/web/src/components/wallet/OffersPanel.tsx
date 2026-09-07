"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/app-context";
import type { OfferOut } from "@/lib/types";
import { Button } from "../ui/Button";
import { Field, inputClass } from "../ui/states";
import { IconCheck, IconClock, IconGift } from "../ui/icons";

/** Friendly copy for the coupon/offer error codes the checkout can return. */
export function useOfferErrorMessage(): (code: string, fallback: string) => string {
  const t = useT();
  return (code, fallback) => {
    switch (code) {
      case "coupon_invalid":
        return t("wallet.coupon_invalid", "That code doesn't exist. Check the spelling and try again.");
      case "coupon_exhausted":
        return t("wallet.coupon_exhausted", "This code has been fully redeemed.");
      case "coupon_inactive":
        return t("wallet.coupon_inactive", "This code is not active right now.");
      case "coupon_region":
        return t("wallet.coupon_region", "This code isn't valid in your region.");
      case "coupon_first_purchase":
        return t("wallet.coupon_first_purchase", "This code is for your first purchase only.");
      case "offer_unavailable":
        return t("wallet.offer_unavailable", "This offer just ended. Refresh to see the current ones.");
      default:
        return fallback;
    }
  };
}

/** Live "ends in …" countdown. Ticks once a minute below a day, once a second in the last minute. */
export function Countdown({ to }: { to: string }) {
  const t = useT();
  const target = Date.parse(to);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!Number.isFinite(target) || target <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!Number.isFinite(target)) return null;
  const left = Math.max(0, target - now);
  if (left === 0) return <span className="text-muted">{t("wallet.offer_ended", "Ended")}</span>;
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  const value = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  return (
    <span className="inline-flex items-center gap-1 tabular-nums text-gold">
      <IconClock size={13} />
      {t("wallet.offer_ends_in", "Ends in {time}", { time: value })}
    </span>
  );
}

/**
 * Offers the viewer is eligible for plus the coupon field. The selected offer / entered code are sent with
 * `POST /v1/purchases/checkout`; the API prices the discount, the client only shows it.
 */
export function OffersPanel({
  offers,
  selectedOfferId,
  onSelectOffer,
  coupon,
  onCouponChange,
  couponError,
  busy,
}: {
  offers: OfferOut[] | null;
  selectedOfferId: string | null;
  onSelectOffer: (id: string | null) => void;
  coupon: string;
  onCouponChange: (value: string) => void;
  couponError: string | null;
  busy: boolean;
}) {
  const t = useT();
  const hasOffers = !!offers && offers.length > 0;

  return (
    <section className="mt-8" aria-label={t("wallet.offers", "Offers")}>
      {hasOffers && (
        <>
          <h2 className="font-display flex items-center gap-2 text-xl font-semibold text-ink">
            <IconGift size={18} className="text-gold" />
            {t("wallet.offers", "Offers")}
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {offers.map((o) => {
              const selected = selectedOfferId === o.id;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelectOffer(selected ? null : o.id)}
                    className={`flex w-full flex-col items-start gap-1 rounded-lg border p-4 text-start transition-colors ${
                      selected ? "border-gold bg-surface2" : "border-gold/40 bg-surface hover:border-gold"
                    }`}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="font-medium text-ink">{o.title}</span>
                      {selected && <IconCheck size={16} className="text-gold" />}
                    </span>
                    {o.discount_pct ? (
                      <span className="font-display text-2xl font-bold text-gold">
                        {t("wallet.offer_discount", "{pct}% off", { pct: o.discount_pct })}
                      </span>
                    ) : null}
                    <span className="text-xs">{o.ends_at ? <Countdown to={o.ends_at} /> : <span className="text-muted">{t("wallet.offer_limited", "Limited time")}</span>}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="mt-4 max-w-sm">
        <Field label={t("wallet.coupon", "Coupon code")} htmlFor="coupon" error={couponError}>
          <div className="flex gap-2">
            <input
              id="coupon"
              name="coupon"
              value={coupon}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              placeholder={t("wallet.coupon_placeholder", "KATHA10")}
              onChange={(e) => onCouponChange(e.target.value.toUpperCase().replace(/\s+/g, "").slice(0, 32))}
              className={`${inputClass} uppercase`}
            />
            {coupon && (
              <Button variant="ghost" onClick={() => onCouponChange("")} disabled={busy}>
                {t("common.clear", "Clear")}
              </Button>
            )}
          </div>
        </Field>
        <p className="mt-1.5 text-xs text-muted">
          {t("wallet.coupon_hint", "The discount is applied when you pick a pack below.")}
        </p>
      </div>
    </section>
  );
}
