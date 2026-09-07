import { useCallback } from "react";
import { useConfig } from "@/providers/config";

/** English strings baked in so every screen renders before `/v1/translations/{lang}` resolves. */
export const en: Record<string, string> = {
  "tabs.home": "Home",
  "tabs.shorts": "Shorts",
  "tabs.list": "My List",
  "tabs.me": "My",
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
  "rewards.title": "Earn Rewards",
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
  "auth.sign_up": "Create account",
  "auth.google": "Continue with Google",
  "auth.phone": "Continue with phone",
  "onboarding.language": "Pick your language",
  "onboarding.continue": "Continue",
  "onboarding.start": "Start watching",
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
