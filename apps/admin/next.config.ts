import type { NextConfig } from "next";

/**
 * The Content-Security-Policy is not here: it carries a per-request script nonce, so `src/proxy.ts` builds it
 * (from `src/lib/csp.ts`) and sets it on every document response. Only the static headers remain.
 */
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
