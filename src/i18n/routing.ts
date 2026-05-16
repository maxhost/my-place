import { defineRouting } from "next-intl/routing";

// Decisión README §Decisiones 1: localePrefix 'always', default 'es', x-default → es.
// ES es el único locale poblado en v1; EN/FR/PT quedan scaffoldeados.
export const routing = defineRouting({
  locales: ["es", "en", "fr", "pt"],
  defaultLocale: "es",
  localePrefix: "always",
  // Accept-Language solo sugiere; el override manual (LangSwitcher) y la
  // cookie NEXT_LOCALE mandan. Sin redirect forzado por header.
  localeDetection: true,
});

export type Locale = (typeof routing.locales)[number];
