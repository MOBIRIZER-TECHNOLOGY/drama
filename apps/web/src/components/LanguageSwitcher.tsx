"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId } from "react";
import { useApp, useT } from "@/lib/app-context";
import { localeHref, stripLang } from "@/lib/languages";
import { IconChevronDown, IconGlobe } from "./ui/icons";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { lang, languages } = useApp();
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const id = useId();

  if (languages.length < 2) return null;

  const change = (code: string) => {
    const rest = stripLang(pathname);
    const qs = search.toString();
    router.push(localeHref(code, rest) + (qs ? `?${qs}` : ""));
  };

  return (
    <label htmlFor={id} className="relative inline-flex items-center">
      <span className="sr-only">{t("nav.language", "Language")}</span>
      <IconGlobe size={16} className="pointer-events-none absolute start-2.5 text-muted" />
      <select
        id={id}
        value={lang}
        onChange={(e) => change(e.target.value)}
        className={`h-9 appearance-none rounded-pill border border-line bg-surface ps-8 pe-7 text-sm text-ink hover:border-muted/60 focus:border-accent focus:outline-none ${compact ? "w-24" : ""}`}
      >
        {languages.map((l) => (
          <option key={l.code} value={l.code}>
            {compact ? l.code.toUpperCase() : l.native_name || l.name}
          </option>
        ))}
      </select>
      <IconChevronDown size={14} className="pointer-events-none absolute end-2.5 text-muted" />
    </label>
  );
}
