import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Static settings live in app.json; this file layers the per-profile values on top.
 * APP_ENV is set by EAS build profiles (development | preview | production); local `expo start` is development.
 */
type AppEnv = "development" | "preview" | "production";

const API_URLS: Record<AppEnv, string> = {
  development: "http://10.0.2.2:8000",
  // TODO(release): replace the placeholders with the real API hosts once DNS is live.
  preview: "https://api-preview.katha.app",
  production: "https://api.katha.app",
};

function appEnv(): AppEnv {
  const v = process.env.APP_ENV;
  return v === "preview" || v === "production" ? v : "development";
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const env = appEnv();
  // Google's iOS URL scheme comes from the iOS OAuth client id (reversed). The plugin only validates the prefix,
  // so a placeholder keeps prebuild working until credentials exist.
  const googleIosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME ?? "com.googleusercontent.apps.PLACEHOLDER";
  return {
    ...config,
    name: config.name ?? "Katha",
    slug: config.slug ?? "katha",
    plugins: [...(config.plugins ?? []), ["@react-native-google-signin/google-signin", { iosUrlScheme: googleIosUrlScheme }]],
    extra: {
      ...config.extra,
      appEnv: env,
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? API_URLS[env],
    },
  };
};
