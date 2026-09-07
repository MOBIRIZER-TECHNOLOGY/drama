import { getLocales } from "expo-localization";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { api, country as deviceCountry } from "@/lib/api";
import { setRemoteFirebaseConfig } from "@/lib/firebase";
import { getBool, getItem, getJson, setBool, setItem, setJson } from "@/lib/storage";
import { defaultConfig, normalizeConfig, type RemoteConfig } from "@/lib/types";

type ConfigContextValue = {
  ready: boolean;
  config: RemoteConfig;
  /** Non-null when the last fetch failed; the cached config (if any) is still in use. */
  configError: string | null;
  dismissConfigError: () => void;
  reloadConfig: () => Promise<void>;
  lang: string;
  setLang: (code: string) => Promise<void>;
  messages: Record<string, string>;
  /** ISO-3166 region from the device locale, for store pricing. */
  country: string;
  onboarded: boolean;
  completeOnboarding: () => Promise<void>;
};

const ConfigContext = createContext<ConfigContextValue | null>(null);

const FETCH_TIMEOUT_MS = 8000;

async function fetchMessages(lang: string): Promise<Record<string, string> | null> {
  try {
    const { data } = await api.GET("/v1/translations/{lang}", { params: { path: { lang } }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return data?.messages ?? null;
  } catch {
    return null;
  }
}

/** Best device-language match among the configured languages, else English. */
function deviceLanguage(config: RemoteConfig): string {
  const codes = config.languages.map((l) => l.code);
  for (const locale of getLocales()) {
    const tag = locale.languageTag?.toLowerCase();
    const code = locale.languageCode?.toLowerCase();
    const hit = codes.find((c) => c.toLowerCase() === tag) ?? codes.find((c) => c.toLowerCase() === code);
    if (hit) return hit;
  }
  return codes.includes("en") ? "en" : (codes[0] ?? "en");
}

export function ConfigProvider({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<RemoteConfig>(defaultConfig);
  const [configError, setConfigError] = useState<string | null>(null);
  const [lang, setLangState] = useState("en");
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [onboarded, setOnboarded] = useState(false);
  const country = deviceCountry;

  const reloadConfig = useCallback(async (): Promise<RemoteConfig | null> => {
    try {
      const { data, error } = await api.GET("/v1/config", { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (data) {
        const normalized = normalizeConfig(data);
        setRemoteFirebaseConfig(normalized.firebase);
        setConfig(normalized);
        setConfigError(null);
        void setJson("configCache", normalized);
        return normalized;
      }
      if (error) setConfigError("Could not load the latest configuration");
    } catch {
      setConfigError("Could not reach the server");
    }
    return null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Hydrate from cache first so the app renders with the last good config even when offline.
      const [storedLang, storedOnboarded, cached] = await Promise.all([getItem("language"), getBool("onboarded"), getJson<RemoteConfig>("configCache")]);
      if (cancelled) return;
      let current = defaultConfig;
      if (cached) {
        current = normalizeConfig(cached);
        setRemoteFirebaseConfig(current.firebase);
        setConfig(current);
      }
      setOnboarded(storedOnboarded);
      const fresh = await reloadConfig();
      if (cancelled) return;
      if (fresh) current = fresh;
      setLangState(storedLang ?? deviceLanguage(current));
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadConfig]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (lang === "en") {
        setMessages({});
        return;
      }
      const cached = await getJson<Record<string, string>>(`messages:${lang}`);
      if (cancelled) return;
      if (cached) setMessages(cached);
      const fresh = await fetchMessages(lang);
      if (cancelled) return;
      if (fresh) {
        setMessages(fresh);
        void setJson(`messages:${lang}`, fresh);
      } else if (!cached) {
        setMessages({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const setLang = useCallback(async (code: string) => {
    setLangState(code);
    await setItem("language", code);
  }, []);

  const completeOnboarding = useCallback(async () => {
    setOnboarded(true);
    await setBool("onboarded", true);
  }, []);

  const dismissConfigError = useCallback(() => setConfigError(null), []);
  const reload = useCallback(async () => {
    await reloadConfig();
  }, [reloadConfig]);

  const value = useMemo<ConfigContextValue>(
    () => ({ ready, config, configError, dismissConfigError, reloadConfig: reload, lang, setLang, messages, country, onboarded, completeOnboarding }),
    [ready, config, configError, dismissConfigError, reload, lang, setLang, messages, country, onboarded, completeOnboarding],
  );

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig must be used inside ConfigProvider");
  return ctx;
}
