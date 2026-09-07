"use client";

import Link from "next/link";
import { useApp, useHref, useT } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { buttonClass } from "./ui/Button";
import { IconCheck, IconCoin, IconGift, IconPlay } from "./ui/icons";

/**
 * What Katha is, for someone who has never heard of it.
 *
 * The home page doubles as the acquisition surface and never said a single thing about the product: a
 * logged-out visitor read no positioning, no proof, and no offer — the only signup control was a 32px header
 * button. This band sits above the catalogue for anonymous visitors only; a returning viewer wants their rails,
 * not a pitch, so it disappears the moment they sign in.
 *
 * The numbers come from config rather than copy, so the free-episode count and signup bonus can never contradict
 * what the paywall actually does.
 */
export function LandingIntro() {
  const t = useT();
  const href = useHref();
  const { config } = useApp();
  const { status, openAuth } = useAuth();

  // Returning viewers get the catalogue. Rendering nothing while auth resolves avoids a flash of the pitch.
  if (status !== "anonymous") return null;

  const freeEpisodes = config?.economy?.free_episodes ?? 0;
  const signupBonus = config?.rewards?.signup_bonus ?? 0;
  const episodePrice = config?.economy?.episode_price ?? 0;
  const bonusEpisodes = episodePrice > 0 ? Math.floor(signupBonus / episodePrice) : 0;

  const points = [
    {
      icon: <IconPlay size={18} />,
      title: t("landing.point_free_title", "Start free"),
      body: freeEpisodes
        ? t("landing.point_free_body", "The first {n} episodes of every drama are free. No card, no account.", { n: freeEpisodes })
        : t("landing.point_free_body_plain", "Start watching straight away. No card, no account."),
    },
    {
      icon: <IconCoin size={18} />,
      title: t("landing.point_coins_title", "Then coins"),
      body: t("landing.point_coins_body", "Unlock what you want to keep watching. Coins never expire and unlocks are permanent."),
    },
    {
      icon: <IconGift size={18} />,
      title: t("landing.point_earn_title", "Earn them back"),
      body: t("landing.point_earn_body", "Check in daily, finish tasks and invite friends for free coins."),
    },
  ];

  return (
    <section className="border-b border-line bg-surface/40" aria-labelledby="landing-heading">
      <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <h1 id="landing-heading" className="font-display max-w-3xl text-3xl font-bold leading-tight text-ink sm:text-4xl">
          {freeEpisodes
            ? t("landing.headline", "Bite-sized dramas in your language. First {n} episodes free.", { n: freeEpisodes })
            : t("landing.headline_plain", "Bite-sized dramas in your language.")}
        </h1>
        <p className="mt-3 max-w-2xl text-base text-ink2">
          {t(
            "landing.subhead",
            "One-minute vertical episodes you can watch on the way to work. New drops every week, in Hindi, Tamil, Telugu, Bengali and English.",
          )}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" onClick={openAuth} className={buttonClass("primary", "lg")}>
            {signupBonus > 0
              ? t("landing.cta_bonus", "Get {n} free coins", { n: signupBonus })
              : t("landing.cta", "Create a free account")}
          </button>
          <Link href={href("/shorts")} className={buttonClass("secondary", "lg")}>
            <IconPlay size={16} />
            {t("landing.cta_watch", "Start watching")}
          </Link>
          {bonusEpisodes > 0 && (
            <span className="text-sm text-muted">
              {t("landing.cta_hint", "That is about {n} more episodes, on us.", { n: bonusEpisodes })}
            </span>
          )}
        </div>

        <ul className="mt-9 grid gap-5 sm:grid-cols-3">
          {points.map((point) => (
            <li key={point.title} className="flex gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-surface2 text-accent">
                {point.icon}
              </span>
              <div>
                <p className="font-medium text-ink">{point.title}</p>
                <p className="mt-0.5 text-sm text-muted">{point.body}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <IconCheck size={13} className="text-success" />
            {t("landing.trust_expiry", "Coins never expire")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <IconCheck size={13} className="text-success" />
            {t("landing.trust_permanent", "Unlocked episodes stay unlocked")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <IconCheck size={13} className="text-success" />
            {t("landing.trust_payments", "Pay with UPI, cards or Google Play")}
          </span>
        </p>
      </div>
    </section>
  );
}
