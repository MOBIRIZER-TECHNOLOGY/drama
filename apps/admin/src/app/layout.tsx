import type { Metadata } from "next";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full" style={tokenVars}>
      <head>
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
