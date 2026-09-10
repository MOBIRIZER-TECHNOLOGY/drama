import type { Metadata } from "next";
import { headers } from "next/headers";
import type { CSSProperties } from "react";
import { colors } from "@katha/tokens";
import { ToastProvider } from "@/components/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Katha Admin", template: "%s · Katha Admin" },
  description: "Operations console for the Katha short-drama platform",
};

/* Status colours from the dark-first token set are tuned for dark ground; the
 * admin runs on light ground, so those three get slightly darker variants. */
const tokenVars = {
  "--accent": colors.accent,
  "--accent-ink": colors.accentInk,
  "--gold": colors.gold,
  "--success": "#2f9c66",
  "--warning": "#c47a1c",
  "--danger": "#d9425c",
} as CSSProperties;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Minted per request by `proxy.ts`. Reading it here makes every page dynamic, which a nonce requires: a
  // page rendered at build time would ship a nonce the browser had never been told about.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className="h-full" style={tokenVars}>
      <head>
        {/* Next puts the nonce on the scripts it emits itself; this is where a client library that has to
            inject one (or a later inline <script> in this layout) reads it from. */}
        {nonce && <meta property="csp-nonce" nonce={nonce} />}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Loaded via <link> rather than next/font so `next build` has no network dependency; this is the root layout so it applies to every page. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400&display=swap"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
