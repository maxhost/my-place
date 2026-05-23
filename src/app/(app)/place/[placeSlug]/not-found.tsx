import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import {
  getHostZoneForZone,
  getPlaceLocaleFallback,
} from "./_lib/get-place-for-zone";
import { resolvePlaceNotFoundContext } from "./_lib/place-not-found-context";

// 404 de la zona Place: lo dispara la page del place cuando el slug no es
// servible (reservado/formato inválido — gate estructural), cuando el place
// no existe en DB (S5b del Hub), o por el defensive check del layout (S3
// Feature B, custom-domain.slug ≠ placeSlug).
//
// Movido en S5a del Hub desde `(app)/not-found.tsx` al sub-árbol
// `place/[placeSlug]/` (restructure multi-root: el layout `(app)/` se eliminó,
// cada sub-grupo provee su `<html>` y su 404 propio).
//
// Feature B S4e (ADR-0031 §"Bug 2 — host-aware 404", 2026-05-22):
// re-escrito de copy literal en español + apex hardcoded a render host-aware
// + locale-aware. La lógica de resolución vive en
// `_lib/place-not-found-context.ts` (helper puro, unit-testeado). Acá queda
// solo orquestación:
//
//   1. `getHostZoneForZone()` — memoizado con el layout. Determina si el 404
//      se sirve desde custom-domain, subdomain canon, o defensive fallback.
//   2. `getPlaceLocaleFallback(slug)` — lookup S4b solo cuando estamos en
//      subdomain canon (en custom-domain el lookup S1 ya trajo el locale).
//      Memoizado por render: si el layout ya lo invocó, 0 queries extras.
//   3. `resolvePlaceNotFoundContext(...)` — helper puro que combina los dos
//      en `{locale, homeHref, ctaKey}`. Discriminated union exhaustivo.
//   4. `getTranslations({locale, namespace: "placeNotFound"})` — i18n con el
//      locale resuelto (paridad ×6 locales enforced por
//      `scripts/check-translations.mjs`, ADR-0024).
//   5. Render `<main>` con copy + CTA contextual.
//
// Sobre el slug del subdomain canon: `not-found.tsx` no recibe `params`
// (limitación del contract de App Router para error/not-found files). Lo
// obtenemos del `HostZone.zone === "place"` que extrae el label DNS del host
// — exactamente la misma fuente que el routing usa para resolver el slug del
// path. Si la zona es custom-domain, el slug viene del lookup S1 (no se
// usa para nada acá, el link es relativo `/`).
//
// `apexMarketingUrl` queda al default del helper (`https://place.community`)
// — el `not-found.tsx` no debería ejecutarse desde apex en el flujo real, así
// que no vale la pena pasar `NEXT_PUBLIC_APP_URL` (sería overhead). El
// helper expone el parámetro para tests + futuras integraciones.

export default async function PlaceNotFound() {
  const hostZone = await getHostZoneForZone();

  // Solo invocamos el lookup S4b cuando estamos en subdomain canon (zona
  // "place"): en custom-domain el `defaultLocale` ya viene del lookup S1
  // (cohabita en `HostZone`); en fallback defensivo se usa el canónico.
  // Evita query DB extra cuando no agrega valor.
  const slugLocaleFallback =
    hostZone.zone === "place" ? await getPlaceLocaleFallback(hostZone.slug) : null;

  const ctx = resolvePlaceNotFoundContext({
    hostZone,
    slugLocaleFallback,
    canonicalDefaultLocale: routing.defaultLocale,
  });

  const t = await getTranslations({
    locale: ctx.locale,
    namespace: "placeNotFound",
  });

  return (
    <main
      id="contenido"
      className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
    >
      <h1 className="text-4xl text-ink">{t("title")}</h1>
      <p className="mt-4 max-w-md leading-relaxed text-muted">{t("body")}</p>
      <a
        href={ctx.homeHref}
        className="cta mt-8 inline-flex min-h-[3rem] items-center justify-center rounded-lg px-7 text-base font-medium"
      >
        {t(ctx.ctaKey)}
      </a>
    </main>
  );
}
