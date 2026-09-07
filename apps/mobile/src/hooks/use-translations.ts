import { useCallback } from "react";
import { useConfig } from "@/providers/config";

/** English strings baked in so every screen renders before `/v1/translations/{lang}` resolves. */
export const en: Record<string, string> = {
  "tabs.home": "Home",
  "tabs.shorts": "Shorts",
  "tabs.list": "My List",
  "tabs.me": "Me",
  "home.continue_watching": "Continue Watching",
  "home.for_you": "For You",
  "home.search": "Search series",
  "home.empty": "Nothing to show yet. Check back soon.",
  "common.retry": "Retry",
  "common.loading": "Loading",
  "common.error": "Something went wrong",
  "common.sign_in": "Sign in",
  "common.play": "Play",
  "common.cancel": "Cancel",
  "series.episodes": "Episodes",
  "series.free": "Free",
  "series.locked_prev": "Unlock previous first",
  "series.similar": "You may also like",
  "player.unlock_title": "Unlock episode",
  "player.unlock_coins": "Unlock with {n} coins",
  "player.watch_ad": "Watch an ad to unlock",
  "player.auto_unlock": "Auto-unlock next episodes",
  "player.balance": "Balance",
  "player.top_up": "Top Up",
  "wallet.title": "Wallet",
  "wallet.top_up": "Top Up",
  "wallet.ledger": "Transaction history",
  "wallet.packs_empty": "No packs available in your region yet.",
  "wallet.offers": "Offers for you",
  "wallet.coupon": "Coupon code",
  "rewards.title": "Rewards",
  "rewards.checkin": "Daily check-in",
  "rewards.claim": "Claim",
  "rewards.claimed": "Claimed",
  "list.favorites": "Favourites",
  "list.history": "History",
  "list.empty_favorites": "Series you save show up here.",
  "list.empty_history": "Episodes you watch show up here.",
  "list.clear": "Clear history",
  "me.guest_title": "Sign in to sync your list, coins and rewards",
  "me.coins": "Coins",
  "me.vip": "VIP",
  "me.settings": "Settings",
  "me.clear_cache": "Clear cache",
  "me.language": "Language",
  "me.privacy": "Privacy policy",
  "me.terms": "Terms of service",
  "me.delete_account": "Delete account",
  "me.sign_out": "Sign out",
  "auth.sign_in": "Sign in",
  "auth.sign_up": "Sign up free",
  "auth.google": "Continue with Google",
  "auth.phone": "Continue with phone",
  "onboarding.language": "Pick your language",
  "onboarding.language_help": "Stories in the language you love. You can change this any time in settings.",
  "onboarding.feed_title": "Swipe through bite-size drama",
  "onboarding.feed_body":
    "Every series is cut into one-minute vertical episodes. Swipe up for the next one, and pick up exactly where you left off.",
  "onboarding.coins_title": "Free episodes, then coins",
  "onboarding.coins_body":
    "The first episodes of every series are free. Unlock the rest with coins: check in daily, complete tasks, or top up.",
  "onboarding.continue": "Continue",
  "onboarding.continue_in": "Continue in {lang}",
  "onboarding.skip": "Skip",
  "onboarding.start": "Start watching",
  // Paywall. The highest-intent screen in the product was hardcoded English inside an otherwise localised app.
  "player.unlock_need": "You need {n} coins to unlock this episode.",
  "player.unlock_position": "Episode {n} of {total}",
  "player.auto_unlock_hint": "Spend coins automatically when the next episode starts.",
  "player.ad_failed": "The reward did not arrive. Try again, or unlock with coins.",
  "player.balance_after": "Balance {n} → {after}",
  "player.bundle_title": "Unlock all {n} remaining episodes",
  "player.bundle_save": "Save {pct}%",
  "player.bundle_cta": "Unlock the whole series",
  "player.sequential_hint": "Episodes unlock in order and stay unlocked forever.",
  "player.signin_bonus": "Sign in and get {n} free coins",
  // Failure states. These were outside the translation system entirely, so a Hindi viewer got English at the
  // three moments they are most likely to give up.
  "common.offline_title": "You are offline",
  "common.offline_body": "Check your connection and try again.",
  "common.error_body": "Something went wrong on our side. Please try again.",
  "common.done": "Done",
  "common.close": "Close",
  // Referral and notifications.
  "referral.title": "Invite a friend — you both get {n} coins",
  "referral.share": "Share invite",
  "referral.copied": "Invite link copied",
  "notifications.title": "Notifications",
  "notifications.enable": "Turn on notifications",
  "notifications.hint": "We will tell you when a new episode lands and before your streak ends.",
};

export function useT() {
  const { messages } = useConfig();
  return useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let s = messages[key] ?? en[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
      return s;
    },
    [messages],
  );
}
