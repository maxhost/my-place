import { getLocale, getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";

// Nombres en su propio idioma (no banderas), links reales y crawleables.
// Server-rendered → cero JS de cliente. La landing es una sola página, así
// que cada link apunta al home del locale.
const LOCALE_NAMES: Record<string, string> = {
  es: "Español",
  en: "English",
  fr: "Français",
  pt: "Português",
};

export async function LangSwitcher() {
  const current = await getLocale();
  const t = await getTranslations("a11y");

  return (
    <nav aria-label={t("language")}>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {routing.locales.map((loc) => {
          const isCurrent = loc === current;
          return (
            <li key={loc}>
              <a
                href={`/${loc}`}
                hrefLang={loc}
                aria-current={isCurrent ? "true" : undefined}
                className={
                  isCurrent
                    ? "text-sm font-medium text-ink"
                    : "text-sm text-muted hover:text-ink"
                }
              >
                {LOCALE_NAMES[loc]}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
