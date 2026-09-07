"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { localeHref } from "./languages";
import type { AppConfig, LanguageOut } from "./types";

export type AppContextValue = {
  lang: string;
  dir: "ltr" | "rtl";
  languages: LanguageOut[];
  messages: Record<string, string>;
  config: AppConfig | null;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ value, children }: { value: AppContextValue; children: ReactNode }) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

export type Translate = (key: string, fallback: string, vars?: Record<string, string | number>) => string;

/** `t("some.key", "Fallback")` returns the translated string or the inline English fallback. */
export function useT(): Translate {
  const { messages } = useApp();
  return useCallback<Translate>(
    (key, fallback, vars) => {
      let s = messages[key] || fallback;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
    [messages],
  );
}

/** Build a language-prefixed href. */
export function useHref(): (path: string) => string {
  const { lang } = useApp();
  return useCallback((path: string) => localeHref(lang, path), [lang]);
}
