import type { HostZone } from "@/shared/lib/host-routing";

// Helper puro de la zona-place (Feature B S4e, ADR-0031 §"Bug 2 — host-aware
// 404", 2026-05-22). Determina locale + link contextual para `not-found.tsx`
// según la zona del request. Aísla la lógica del componente Server para
// dejarla unit-testeable sin mockear `next/headers` ni `next-intl`.
//
// Background del bug pre-existente:
//
// El `not-found.tsx` de la zona-place servía copy literal en español y un
// link hardcoded a `https://place.community` (apex marketing) para TODOS los
// casos. Síntomas:
//   1. Visitor anónimo en `mi-place.place.community/url-rota` o
//      `nocodecompany.co/url-rota` veía el chrome del lugar localizado en el
//      `place.default_locale` (e.g., 'pt') pero el 404 en 'es' literal.
//   2. El CTA del 404 lo mandaba al apex genérico (`place.community`)
//      perdiendo el contexto del lugar que estaba explorando. Especialmente
//      grave en custom-domain: el visitor en `nocodecompany.co` aterriza en
//      `place.community` (marca distinta) en vez de volver a la home del
//      lugar.
//
// Política de resolución por zona (3 ramas):
//
//   - **`custom-domain`**: el lookup S1 (`app.lookup_place_by_domain`
//     SECURITY DEFINER) ya resolvió `defaultLocale` en el wrapper async
//     `resolveHostWithCustomDomains` — usar ese (autoritativo, viene del
//     `place.default_locale` filtrado por `archived_at IS NULL`). El link es
//     RELATIVO `/`: el visitor vuelve a la home del MISMO custom-domain
//     (`nocodecompany.co/` → proxy rewrite → placeholder de
//     `/place/mi-place/`). Defensa de doxxing: NO revelar el slug interno
//     (`mi-place`) que el owner posiblemente no quiere exponer.
//
//   - **`place`** (subdomain canon, `<slug>.place.community`): el visitor
//     anónimo NO tiene sesión, así que el caller (`not-found.tsx`) invocó
//     `getPlaceLocaleFallback(slug)` — wrapper S4b sobre
//     `app.lookup_place_locale_by_slug` (DEFINER). El payload es el escalar
//     `default_locale` o `null` (slug no existe, archivado, error DB,
//     drift). Cuando es `null`, caer al `canonicalDefaultLocale` ('es') —
//     misma policy del layout (precedence 4 del `<html lang>`, ver
//     `layout.tsx` §"Precedence del `lang`"). Link RELATIVO `/`: en
//     subdomain canon el visitor vuelve a la home placeholder del mismo
//     place.
//
//   - **`marketing`** / **`inbox`** (defensive): este `not-found.tsx` vive
//     en el árbol `(app)/place/[placeSlug]/` — el routing NO debería
//     dispararlo desde apex o `app.<root>` (cada zona tiene su propio
//     `not-found.tsx`). Pero si algún edge case lo dispara
//     (e.g., un `notFound()` manual dentro de un Server Action que se
//     ejecuta cross-zone, o un bug futuro de routing), el fallback es
//     conservador: locale canónico + link absoluto al apex marketing.
//
// `apexMarketingUrl`: parámetro opcional para que el caller pase el valor
// derivado de `NEXT_PUBLIC_APP_URL` sin que el helper toque `process.env`
// (pureza). Default `'https://place.community'` por consistencia con la
// declaración de hosts del routing (`host-routing.ts:58`).

/**
 * Variantes del CTA según contexto. El componente las mapea a labels i18n
 * del namespace `placeNotFound` (S4e):
 *   - `ctaHome` — "Volver al inicio" (link relativo `/`, dentro del lugar).
 *   - `ctaApex` — "Ir a Place" (link absoluto al apex marketing, fallback).
 */
export type PlaceNotFoundCtaKey = "ctaHome" | "ctaApex";

/**
 * Resultado del helper. El Server Component lo consume directo:
 *   `<a href={ctx.homeHref}>{t(ctx.ctaKey)}</a>`.
 */
export type PlaceNotFoundContext = {
  /**
   * Locale ISO 639-1 (uno de los 6 operativos) para `getTranslations`. El
   * helper NUNCA retorna `null`: cuando el lookup falla, cae al
   * `canonicalDefaultLocale` recibido. Garantiza que el render del 404
   * siempre tenga copy válido.
   */
  locale: string;
  /**
   * `href` del botón "Volver al inicio". Relativo `/` para zonas dentro del
   * árbol place (custom-domain + subdomain canon); absoluto al apex
   * marketing en el fallback defensivo.
   */
  homeHref: string;
  /**
   * Key del label CTA en el namespace `placeNotFound`. El componente hace
   * `t(ctx.ctaKey)` — el discriminated union mantiene los dos variantes
   * exhaustivos (exhaustive check al agregar variantes).
   */
  ctaKey: PlaceNotFoundCtaKey;
};

type Args = {
  hostZone: HostZone;
  slugLocaleFallback: string | null;
  canonicalDefaultLocale: string;
  apexMarketingUrl?: string;
};

const DEFAULT_APEX_MARKETING_URL = "https://place.community";

export function resolvePlaceNotFoundContext(args: Args): PlaceNotFoundContext {
  const {
    hostZone,
    slugLocaleFallback,
    canonicalDefaultLocale,
    apexMarketingUrl = DEFAULT_APEX_MARKETING_URL,
  } = args;

  switch (hostZone.zone) {
    case "custom-domain":
      // Lookup S1 ya trajo el defaultLocale del owner — autoritativo.
      // Link relativo: no doxxear el slug interno al visitor del
      // custom-domain.
      return {
        locale: hostZone.defaultLocale,
        homeHref: "/",
        ctaKey: "ctaHome",
      };

    case "place":
      // Visitor anónimo en subdomain canon. `slugLocaleFallback` viene del
      // lookup S4b (puede ser null por: slug no existe, archivado, DB error,
      // drift TS↔DB). Fallback al canónico — misma policy del layout.
      return {
        locale: slugLocaleFallback ?? canonicalDefaultLocale,
        homeHref: "/",
        ctaKey: "ctaHome",
      };

    case "marketing":
    case "inbox":
      // Defensive fallback. El árbol `(app)/place/[placeSlug]/not-found.tsx`
      // no debería ejecutarse desde estas zonas (cada una tiene su propio
      // not-found.tsx). Pero si pasa: locale canónico + link al apex.
      return {
        locale: canonicalDefaultLocale,
        homeHref: apexMarketingUrl,
        ctaKey: "ctaApex",
      };
  }
}
