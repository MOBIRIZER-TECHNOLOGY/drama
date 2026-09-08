import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useMemo } from "react";
import { useConfig } from "@/providers/config";

/**
 * Opening the privacy policy and the terms, the same way from everywhere.
 *
 * These live in two places at once by design: an operator can point `mobile.privacy_policy_url` at a hosted
 * document, and when they have not, the CMS page of the same name is the fallback. That rule was written once
 * on the settings screen and then written differently on the sign-in screen, which sent the consent line
 * straight to the CMS page and quietly ignored the configured URL. Two routes to one document is one too
 * many, so the rule lives here now and both callers use it.
 */
export function useLegalLinks() {
  const router = useRouter();
  const { config } = useConfig();

  const open = useCallback(
    (url: string | null | undefined, slug: string) => {
      if (url) {
        WebBrowser.openBrowserAsync(url, {
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        }).catch(() => {});
        return;
      }
      router.push({ pathname: "/page/[slug]", params: { slug } });
    },
    [router],
  );

  return useMemo(
    () => ({
      openPrivacy: () => open(config.mobile.privacy_policy_url, "privacy"),
      openTerms: () => open(config.mobile.terms_url, "terms"),
      // Same rule, same reason: an operator sets a store URL, and without one there is a page to fall back on.
      openRateUs: () => open(config.mobile.rate_us_url, "rate"),
    }),
    [open, config.mobile.privacy_policy_url, config.mobile.terms_url, config.mobile.rate_us_url],
  );
}
