import Link from "next/link";
import { lang as rootLang } from "next/root-params";
import { buttonClass } from "@/components/ui/Button";
import { DEFAULT_LANG, isSupportedLang, localeHref } from "@/lib/languages";
import { fetchTranslations } from "@/lib/server-data";

export default async function NotFound() {
  const current = (await rootLang()) ?? DEFAULT_LANG;
  const lang = isSupportedLang(current) ? current : DEFAULT_LANG;
  const messages = await fetchTranslations(lang);
  const t = (key: string, fallback: string) => messages[key] || fallback;
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-24 text-center">
      <p className="font-display text-6xl font-bold text-accent">404</p>
      <h1 className="font-display text-2xl font-semibold text-ink">{t("not_found.title", "This page is missing")}</h1>
      <p className="text-sm text-muted">
        {t("not_found.message", "The drama you are looking for may have moved or is no longer published.")}
      </p>
      <Link href={localeHref(lang, "/")} className={buttonClass("secondary")}>
        {t("not_found.home", "Back to home")}
      </Link>
    </div>
  );
}
