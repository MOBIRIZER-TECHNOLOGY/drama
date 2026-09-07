/**
 * What the known settings keys mean.
 *
 * The screen was a raw key/value grid over production configuration: an editor faced with
 * `default_episode_price` had no idea of the unit, the valid range, or what it would do — and one keystroke
 * changes the price of every episode in the catalogue.
 *
 * This annotates the keys we ship. Unknown keys still render, because an admin can add their own; they simply
 * get no help. `sensitive` marks the values that move money or gate access, which the save dialog calls out
 * separately from the rest of the diff.
 */

export type SettingKind = "text" | "number" | "boolean" | "json";

export type SettingSpec = {
  label: string;
  description: string;
  kind: SettingKind;
  /** Shown after the input, e.g. "coins", "days". */
  unit?: string;
  min?: number;
  max?: number;
  /** Moves money or gates access: changing it needs a second look. */
  sensitive?: boolean;
};

export const SETTINGS_SCHEMA: Record<string, Record<string, SettingSpec>> = {
  economy: {
    coins_enabled: {
      label: "Coins enabled",
      description: "Turns the whole coin economy off. Viewers keep their balances; nothing can be spent or bought.",
      kind: "boolean",
      sensitive: true,
    },
    currency: {
      label: "Default currency",
      description: "ISO 4217 code used when a viewer's country has no specific price row.",
      kind: "text",
      sensitive: true,
    },
    currency_symbol: { label: "Currency symbol", description: "Shown beside prices in the apps.", kind: "text" },
    episode_price: {
      label: "Episode price",
      description: "Coins to unlock one episode, unless a series or episode overrides it.",
      kind: "number",
      unit: "coins",
      min: 0,
      max: 10_000,
      sensitive: true,
    },
    free_episodes: {
      label: "Free episodes",
      description: "How many episodes play without paying, unless a series overrides it. This is where the paywall lands.",
      kind: "number",
      unit: "episodes",
      min: 0,
      max: 100,
      sensitive: true,
    },
    bundle_discount_pct: {
      label: "Bundle discount",
      description: "Saving when a viewer unlocks every remaining episode at once.",
      kind: "number",
      unit: "%",
      min: 0,
      max: 90,
      sensitive: true,
    },
    ad_unlocks_per_day: {
      label: "Ad unlocks per day",
      description: "Free unlocks a viewer can earn daily by watching rewarded ads. Too generous and it replaces buying coins.",
      kind: "number",
      unit: "per day",
      min: 0,
      max: 50,
      sensitive: true,
    },
  },
  rewards: {
    enabled: { label: "Rewards enabled", description: "Turns off the check-in and every task.", kind: "boolean", sensitive: true },
    signup_bonus: {
      label: "Signup bonus",
      description: "Coins credited on account creation. Advertised on the sign-in dialog and the landing band.",
      kind: "number",
      unit: "coins",
      min: 0,
      max: 100_000,
      sensitive: true,
    },
    daily_rewards: {
      label: "Check-in ladder",
      description: "Coins per streak day, as a JSON array. Its length is the cycle, and the last entry is the jackpot both clients highlight.",
      kind: "json",
      sensitive: true,
    },
  },
  referral: {
    enabled: { label: "Referral enabled", description: "Hides the invite card and stops new links paying out.", kind: "boolean" },
    referrer_coins: {
      label: "Referrer reward",
      description: "Paid to the inviter the first time the person they invited spends money.",
      kind: "number",
      unit: "coins",
      min: 0,
      max: 100_000,
      sensitive: true,
    },
    referee_coins: {
      label: "Invitee reward",
      description: "Credited at signup to anyone who arrived through an invite link.",
      kind: "number",
      unit: "coins",
      min: 0,
      max: 100_000,
      sensitive: true,
    },
  },
  mobile: {
    min_version_code: {
      label: "Minimum build",
      description: "Android versionCode below this is blocked at launch. Raising it locks out everyone on an older build.",
      kind: "number",
      min: 1,
      sensitive: true,
    },
    force_update: {
      label: "Force update",
      description: "Blocks every build below the minimum, with no way past the screen.",
      kind: "boolean",
      sensitive: true,
    },
    update_url: { label: "Update URL", description: "Store listing the update screen opens.", kind: "text" },
    privacy_policy_url: { label: "Privacy policy URL", description: "Opened from the Me tab. Falls back to the in-app CMS page.", kind: "text" },
    terms_url: { label: "Terms URL", description: "Opened from the Me tab. Falls back to the in-app CMS page.", kind: "text" },
    rate_us_url: { label: "Rate us URL", description: "Store review link. Hidden when empty.", kind: "text" },
  },
  auth: {
    email: { label: "Email sign-in", description: "Shows the email and password tab.", kind: "boolean" },
    google: { label: "Google sign-in", description: "Shows Continue with Google.", kind: "boolean" },
    apple: { label: "Apple sign-in", description: "Required by App Store review when any other social sign-in is offered.", kind: "boolean" },
    phone: { label: "Phone sign-in", description: "Shows the phone and OTP tab, which leads on the web dialog.", kind: "boolean" },
    facebook: { label: "Facebook sign-in", description: "Not implemented in the clients yet.", kind: "boolean" },
  },
  payments: {
    stripe: { label: "Stripe", description: "Offer Stripe checkout on the web.", kind: "boolean", sensitive: true },
    razorpay: { label: "Razorpay", description: "Offer Razorpay on the web. Leads when charging in rupees.", kind: "boolean", sensitive: true },
    play: { label: "Google Play", description: "Offer Play Billing in the Android app. Required by Play policy.", kind: "boolean", sensitive: true },
  },
  site: {
    name: { label: "Site name", description: "Used in page titles and share cards.", kind: "text" },
    url: { label: "Site URL", description: "Absolute base URL used to build share and email links.", kind: "text" },
  },
};

export function specFor(namespace: string, key: string): SettingSpec | null {
  return SETTINGS_SCHEMA[namespace]?.[key] ?? null;
}

/** Validate a value against its spec. Returns an error message, or null when it is acceptable. */
export function validate(spec: SettingSpec | null, raw: string): string | null {
  if (!spec) return null;
  const value = raw.trim();
  if (spec.kind === "number") {
    if (!/^-?\d+(\.\d+)?$/.test(value)) return "Must be a number.";
    const n = Number(value);
    if (spec.min != null && n < spec.min) return `Must be at least ${spec.min}.`;
    if (spec.max != null && n > spec.max) return `Must be at most ${spec.max}.`;
  }
  if (spec.kind === "boolean" && !["true", "false"].includes(value)) return "Must be true or false.";
  if (spec.kind === "json") {
    try {
      JSON.parse(value);
    } catch {
      return "Not valid JSON.";
    }
  }
  return null;
}

/**
 * Coerce an edited string back to the type the API expects.
 *
 * Everything arrives from an <input> as a string, and writing "50" where the economy expects the number 50
 * silently changes the type of a live setting.
 */
export function coerce(spec: SettingSpec | null, raw: string): unknown {
  if (!spec) return raw;
  const value = raw.trim();
  if (spec.kind === "number") return Number(value);
  if (spec.kind === "boolean") return value === "true";
  if (spec.kind === "json") return JSON.parse(value);
  return raw;
}
