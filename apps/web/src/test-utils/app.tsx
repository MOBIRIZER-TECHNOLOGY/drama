import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { AppProvider, type AppContextValue } from "@/lib/app-context";

export const defaultApp: AppContextValue = {
  lang: "en",
  dir: "ltr",
  languages: [
    { code: "en", name: "English", native_name: "English", rtl: false },
    { code: "hi", name: "Hindi", native_name: "हिन्दी", rtl: false },
  ],
  messages: {},
  config: null,
};

export function appWrapper(overrides: Partial<AppContextValue> = {}) {
  const value = { ...defaultApp, ...overrides };
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AppProvider value={value}>{children}</AppProvider>;
  };
}

export function renderWithApp(ui: ReactElement, overrides: Partial<AppContextValue> = {}, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, { wrapper: appWrapper(overrides), ...options });
}
