import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { getLocales } from "expo-localization";
import { Platform } from "react-native";

let cachedDeviceId: string | null | undefined;

/** Stable per-install identifier: androidId on Android, identifierForVendor on iOS. */
export async function getDeviceId(): Promise<string | null> {
  if (cachedDeviceId !== undefined) return cachedDeviceId;
  try {
    cachedDeviceId = Platform.OS === "android" ? Application.getAndroidId() : await Application.getIosIdForVendorAsync();
  } catch {
    cachedDeviceId = null;
  }
  return cachedDeviceId;
}

export function getDeviceName(): string | null {
  const parts = [Device.manufacturer, Device.modelName].filter((p): p is string => typeof p === "string" && p.length > 0);
  return parts.length ? parts.join(" ") : null;
}

/** Marketing version ("1.2.0"), without the build number. */
export function getMarketingVersion(): string {
  return Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "0.0.0";
}

export function getAppVersion(): string {
  const version = getMarketingVersion();
  const build = Application.nativeBuildVersion;
  return build ? `${version} (${build})` : version;
}

/**
 * Integer version code compared against `config.mobile.min_version_code`: Android `versionCode`, iOS
 * `CFBundleVersion`. `null` when the binary does not carry one (Expo Go, web), which disables the update gate.
 */
export function getVersionCode(): number | null {
  const raw = Application.nativeBuildVersion;
  if (!raw) return null;
  // iOS build numbers may be dotted ("1.0.3"); the leading integer is the comparable part.
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/** Store listing for this binary, used when `config.mobile.update_url` is not set. */
export function getStoreUrl(): string {
  const id = Application.applicationId ?? "com.mobirizer.katha";
  if (Platform.OS === "ios") {
    // TODO(release): replace with the App Store id (https://apps.apple.com/app/id<APPLE_ID>) once the app exists.
    return `https://apps.apple.com/search?term=${encodeURIComponent(Constants.expoConfig?.name ?? "Katha")}`;
  }
  return `https://play.google.com/store/apps/details?id=${id}`;
}

/** ISO-3166 alpha-2 region from the device locale (upper-case), or null when the OS reports none. */
export function getDeviceCountry(): string | null {
  try {
    const region = getLocales()[0]?.regionCode;
    return region && region.length === 2 ? region.toUpperCase() : null;
  } catch {
    return null;
  }
}

export function getOsVersion(): string | null {
  return Device.osVersion ?? null;
}

export function getDeviceModel(): string | null {
  return Device.modelName ?? null;
}

/** Total RAM in GB, one decimal; null when unknown. */
export function getRamGb(): number | null {
  const bytes = Device.totalMemory;
  if (!bytes || bytes <= 0) return null;
  return Math.round((bytes / 1024 ** 3) * 10) / 10;
}
