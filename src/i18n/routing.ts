import { defineRouting } from "next-intl/routing";

// Decisión README §Decisiones 1: localePrefix 'always', default 'es', x-default → es.
//
// 6 locales operativos día uno (ADR-0022, ADR-0024 — 2026-05-20). Sólo `es.json`
// existe como catálogo denso en `messages/`; `de.json` se agrega en S1.a y
// `ca.json` en S1.b, ambos como copias de `es.json` (stubs hasta traducción
// real). `en/fr/pt` no tienen archivo físico — el deep-merge runtime en
// `request.ts` con try/catch defensivo degrada a `defaultLocale` para esos
// locales sin romper UX. El script `scripts/check-translations.mjs` (S1.b)
// reporta el drift de forma informativa, no fail-closed.
export const routing = defineRouting({
  locales: ["es", "en", "fr", "pt", "de", "ca"],
  defaultLocale: "es",
  localePrefix: "always",
  // Accept-Language solo sugiere; el override manual (LangSwitcher) y la
  // cookie NEXT_LOCALE mandan. Sin redirect forzado por header.
  localeDetection: true,
});

export type Locale = (typeof routing.locales)[number];
