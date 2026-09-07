import type { MetadataRoute } from "next";
import { colors } from "@/lib/tokens";

/**
 * PWA manifest. A large share of this audience will not install a 60MB APK on first contact, and "Add to home
 * screen" is the cheapest install path available on Android — but Chrome only offers it with a manifest, and
 * without one the resulting shortcut carries an unbranded default icon.
 *
 * `display: standalone` plus a portrait orientation matches how the app is actually used; the shortcuts are the
 * two surfaces worth a long-press.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Katha — short dramas",
    short_name: "Katha",
    description: "Binge bite-sized dramas in your language.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: colors.ground,
    theme_color: colors.ground,
    categories: ["entertainment", "video"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Shorts", url: "/shorts" },
      { name: "Rewards", url: "/rewards" },
    ],
  };
}
