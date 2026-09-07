"use client";

import { useEffect, type ReactNode } from "react";
import { trackAppOpen } from "@/lib/analytics";
import { AppProvider, type AppContextValue } from "@/lib/app-context";
import { captureReferral } from "@/lib/referral";
import { AuthProvider } from "@/lib/auth-context";
import { ToastProvider } from "@/lib/toast";
import { AuthDialog } from "./AuthDialog";

export function Providers({ value, children }: { value: AppContextValue; children: ReactNode }) {
  return (
    <AppProvider value={value}>
      <ToastProvider>
        <AuthProvider>
          <AppOpen lang={value.lang} />
          {children}
          <AuthDialog />
        </AuthProvider>
      </ToastProvider>
    </AppProvider>
  );
}

/** `app_open` once per browser session (the analytics session id lives in sessionStorage). */
function AppOpen({ lang }: { lang: string }) {
  useEffect(() => {
    trackAppOpen(lang);
    // An invite link lands here, but the account is created later — possibly after a Google redirect that
    // replaces the document — so the code is parked now and attached to whichever exchange eventually happens.
    captureReferral(window.location.search);
  }, [lang]);
  return null;
}
