import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/api";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Account and transient pages carry no crawlable content.
        disallow: ["/api/", "/wallet", "/*/wallet", "/profile", "/*/profile", "/my-list", "/*/my-list", "/rewards", "/*/rewards", "/search", "/*/search"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
