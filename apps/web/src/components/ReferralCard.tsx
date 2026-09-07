"use client";

import { useState } from "react";
import { track } from "@/lib/analytics";
import { SITE_URL } from "@/lib/api";
import { useApp, useT } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";
import { Button } from "./ui/Button";
import { IconCheck, IconCoin, IconShare } from "./ui/icons";

/**
 * The referral loop, surfaced.
 *
 * The server has linked referrers to referees and paid out since day one, but the only trace of it in the
 * product was the code printed as a caption on the profile page — no link to share, no statement of the reward,
 * and nothing for the referrer to gain by asking. In this market a two-sided invite outperforms paid
 * acquisition, so it belongs on Rewards (where people come to earn) and on Profile.
 *
 * WhatsApp is the share channel that matters here, so it gets its own button rather than hiding behind the
 * generic share sheet, which desktop browsers do not implement at all.
 */
export function ReferralCard() {
  const t = useT();
  const toast = useToast();
  const { config } = useApp();
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);

  const referral = config?.referral;
  const code = user?.referral_code;
  if (!code || referral?.enabled === false) return null;

  const referrerCoins = referral?.referrer_coins ?? 0;
  const refereeCoins = referral?.referee_coins ?? 0;
  const link = `${SITE_URL}/?ref=${encodeURIComponent(code)}`;
  const message = t("referral.message", "I'm watching short dramas on Katha. Use my link and we both get free coins: {link}", {
    link,
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast(t("referral.copied", "Invite link copied"), "success");
      track("referral_share", { method: "copy" });
    } catch {
      toast(t("referral.copy_failed", "Could not copy the link"), "error");
    }
  };

  const share = async () => {
    track("referral_share", { method: "share" });
    if (navigator.share) {
      try {
        await navigator.share({ title: "Katha", text: message, url: link });
        return;
      } catch {
        // The viewer dismissed the sheet, or the browser refused: fall through to copying.
      }
    }
    await copy();
  };

  return (
    <section className="rounded-lg border border-gold/40 bg-gold/5 p-5">
      <h2 className="font-display text-lg font-semibold text-ink">
        {refereeCoins > 0
          ? t("referral.title", "Invite a friend — you both get {n} coins", { n: referrerCoins || refereeCoins })
          : t("referral.title_plain", "Invite a friend")}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {t(
          "referral.hint",
          "They get {referee} coins the moment they join. You get {referrer} coins the first time they top up.",
          { referee: refereeCoins, referrer: referrerCoins },
        )}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <code className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm tracking-widest text-gold">
          {code}
        </code>
        <Button variant="secondary" onClick={() => void copy()}>
          {copied ? <IconCheck size={16} /> : <IconCoin size={16} />}
          {copied ? t("referral.copied_short", "Copied") : t("referral.copy", "Copy link")}
        </Button>
        <Button variant="gold" onClick={() => void share()}>
          <IconShare size={16} />
          {t("referral.share", "Share invite")}
        </Button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track("referral_share", { method: "whatsapp" })}
          className="text-sm font-medium text-accent underline-offset-4 hover:underline"
        >
          {t("referral.whatsapp", "Send on WhatsApp")}
        </a>
      </div>
    </section>
  );
}
