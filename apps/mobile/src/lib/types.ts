import type { components } from "@katha/api-client";

export type SeriesCard = components["schemas"]["SeriesCard"];
export type SeriesDetail = components["schemas"]["SeriesDetail"];
export type Episode = components["schemas"]["EpisodeOut"];
export type HomeRail = components["schemas"]["HomeRail"];
export type HistoryItem = components["schemas"]["HistoryItem"];
export type ContinueProgress = components["schemas"]["ContinueProgress"];
export type PlayOut = components["schemas"]["PlayOut"];
export type SubtitleTrackOut = components["schemas"]["SubtitleTrack"];
export type UserOut = components["schemas"]["UserOut"];
export type WalletOut = components["schemas"]["WalletOut"];
export type Pack = components["schemas"]["PackOut"];
/** Wallet offer card (`GET /v1/wallet/offers`); the admin schema has a different `OfferOut`. */
export type Offer = components["schemas"]["app__api__routers__wallet__OfferOut"];
export type LedgerRow = components["schemas"]["LedgerRow"];
export type PurchaseOut = components["schemas"]["PurchaseOut"];
export type CheckinStatus = components["schemas"]["CheckinStatus"];
export type RewardTask = components["schemas"]["TaskOut"];
export type Language = components["schemas"]["ConfigLanguage"];
export type RemoteConfig = components["schemas"]["ConfigOut"];
export type FirebaseWebConfig = components["schemas"]["FirebaseWebConfig"];

/** Rendered before `GET /v1/config` resolves, and kept when it fails. */
export const defaultConfig: RemoteConfig = {
  platform: "android",
  site: { name: "Katha", url: null, captcha_site_key: null },
  payments: { gateways: [] },
  firebase: null,
  auth: { email: true, google: true, apple: false, phone: true, facebook: false },
  economy: { coins_enabled: true, currency: "INR", currency_symbol: "₹", episode_price: 50, free_episodes: 5, ad_unlocks_per_day: 5 },
  rewards: { enabled: true, daily_rewards: [10, 20, 30, 40, 50, 60, 70], signup_bonus: 100 },
  mobile: { min_version_code: 1, force_update: false, update_url: null, privacy_policy_url: null, terms_url: null, rate_us_url: null },
  languages: [{ code: "en", name: "English", native_name: "English", rtl: false }],
  flags: {},
  variants: {},
};

/** Fill the sub-objects the UI reads so a partially populated config never crashes a screen. */
export function normalizeConfig(raw: RemoteConfig): RemoteConfig {
  return {
    ...defaultConfig,
    ...raw,
    site: { ...defaultConfig.site, ...raw.site },
    payments: { gateways: raw.payments?.gateways ?? [] },
    auth: { ...defaultConfig.auth, ...raw.auth },
    economy: { ...defaultConfig.economy, ...raw.economy },
    rewards: { ...defaultConfig.rewards, ...raw.rewards },
    mobile: { ...defaultConfig.mobile, ...raw.mobile },
    languages: raw.languages?.length ? raw.languages : defaultConfig.languages,
    flags: raw.flags ?? {},
    variants: raw.variants ?? {},
  };
}
