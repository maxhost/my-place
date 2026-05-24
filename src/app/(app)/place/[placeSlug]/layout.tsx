import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { routing } from "@/i18n/routing";
import {
  getHostZoneForZone,
  getPlaceForZone,
  getPlaceLocaleFallback,
} from "./_lib/get-place-for-zone";
import "../../../globals.css";

// Layout de la zona Place (multi-root, Next 16 — `docs/multi-tenancy.md`).
// Creado en S5a del Hub junto al restructure del árbol `(app)` (el layout
// común `(app)/layout.tsx` se eliminó: cada sub-grupo provee su `<html>`
// para soportar `lang` propio).
//
// Evolucionado en S6 del feature `settings` (`docs/features/settings/spec.md`
// + ADR-0022): el chrome de la zona-place se renderea en el idioma elegido
// por el owner (`place.default_locale` editable). Para sostener el contract
// `<html lang>` (a11y + SEO + i18n DB-based, ADR-0024), el layout carga el
// place vía el helper privado `getPlaceForZone(slug)` y deriva el `lang` del
// resultado. El helper está memoizado con `React.cache()` para deduplicar
// con la query equivalente del settings page (`/settings/page.tsx`) — 1
// sola lectura de cookie + 1 sola SELECT por request, aunque ambos
// consumidores estén en el mismo árbol.
//
// Fallback `lang="es"`: si el caller no tiene sesión (visitante público a la
// portada placeholder) o no es owner del place (RLS filtra), el helper
// retorna `null`. El layout NO falla — usa el default canónico de
// `routing.defaultLocale` para el `<html lang>`. El page del settings hace
// su propio guard sobre `null` (redirect/notFound según contexto, S6).
//
// Skip-link a11y: paralelo al pattern del marketing
// (`(marketing)/[locale]/layout.tsx`). Target = `#contenido`, presente en el
// `<main>` de las pages de la zona (settings + portada). Localizado con el
// `lang` derivado vía namespace `a11y`.
//
// Feature B S3 (ADR-0031 §3, 2026-05-22):
//   1. **Defensive slug→host validation**. Si el request entra por un custom
//      domain, validamos que el `place_domain.slug` resuelto desde el host
//      coincide con el `placeSlug` del path. El proxy ya rewrite-ea al slug
//      correcto, pero un crawler con `Host:` fabricado, un bug futuro de
//      rewrite, o un actor accediendo a `/place/X` por una ruta interna
//      NUNCA debería servir el place de otro en un host ajeno. `notFound()`
//      antes de cualquier query owner-only — fail-closed.
//   2. **Fallback `lang` para visitor anónimo en custom domain**. La cookie
//      Neon Auth es host-only `.place.community` (ADR-0031 §"Cookie
//      cross-domain gap"); el visitor en `nocodecompany.co` NO tiene sesión
//      → `getPlaceForZone` retorna null → sin esta fix, `<html lang="es">`
//      pese a que el owner configuró `pt`. El lookup anonymous-safe (S1)
//      ya retornó `defaultLocale` en el wrapper async; lo usamos como
//      precedence 2 entre el placeData del owner y el default canónico.
//
// Feature B S4c (ADR-0031 §"Fuente 2", 2026-05-22):
//   3. **Fallback `lang` para visitor anónimo en SUBDOMAIN CANON**. Caso
//      simétrico de (2) que faltaba: visitor en `mi-place.place.community/`
//      sin sesión → `hostZone.zone === "place"` (no `custom-domain`, así que
//      precedence 2 no aplica) Y `getPlaceForZone` retorna null por RLS
//      owner-only. Pre-S4c caía a `routing.defaultLocale` ('es') aunque el
//      owner configuró 'pt'. S4c agrega `getPlaceLocaleFallback(placeSlug)`
//      —wrapper memoizado sobre `lookupPlaceLocaleBySlug` (S4b, función SQL
//      SECURITY DEFINER `app.lookup_place_locale_by_slug`)— como precedence
//      3, ANTES del fallback canónico. El cache `React.cache()` deduplica
//      con los consumers del settings (page + domain page que necesitan el
//      locale para `buildApexLoginUrl`).
//
// Costo del defensive check + S4c lookup en hot path:
//   - Visitor a `<slug>.place.community/...` con sesión owner: 0 queries
//     extras (place se carga por RLS, lookup S4c skip — guard `place ===
//     null`).
//   - Visitor a `<slug>.place.community/...` SIN sesión (visitor anónimo,
//     hot path típico de portada placeholder): 1 query DB (lookup S4c).
//     Memoizada — si el settings page lo invoca también, 0 queries extras.
//   - Visitor a `nocodecompany.co/...` (custom domain): 1 query DB (la del
//     wrapper async S1/S3). Sumada a la query del proxy (middleware) son 2
//     por request. ADR-0031 §"Lookup query cost" acepta el tradeoff V1;
//     V1.1 puede agregar TTL cache si p95 > 100ms.

type Props = {
  children: ReactNode;
  params: Promise<{ placeSlug: string }>;
};

export default async function PlaceLayout({ children, params }: Props) {
  const { placeSlug } = await params;

  // Defensive slug→host validation + fuente de truth del locale en custom
  // domain. `getHostZoneForZone` memoiza por render: la primera llamada
  // (acá) corre la lectura del header `host` + (potencial) query del lookup
  // S1/S3; las siguientes (e.g. `settings/page.tsx` para decidir auth-gate
  // vs redirect, S4d) reusan el resultado sin re-tocar Neon. Política de
  // skip estructural (host-routing.ts S2): subdomain canon, apex, *.localhost
  // y *.vercel.app NO consultan DB.
  const hostZone = await getHostZoneForZone();
  if (hostZone.zone === "custom-domain" && hostZone.slug !== placeSlug) {
    // Algún actor accedió a `/place/{otherSlug}` por una ruta interna del host
    // de otro custom domain — fail-closed antes de leer DB owner-only.
    notFound();
  }

  const place = await getPlaceForZone(placeSlug);

  // Precedence 3 (S4c): visitor anónimo en SUBDOMAIN CANON. Sólo cuando
  // `place === null` (RLS owner-only sin sesión) Y la zona NO es custom-domain
  // (en custom-domain el `hostZone.defaultLocale` ya tiene el locale del
  // lookup S1/S3 — no duplicar query). Memoizado por render: si las pages
  // del settings llaman `getPlaceLocaleFallback` después, reusan este result.
  const anonymousCanonLocale =
    place === null && hostZone.zone !== "custom-domain"
      ? await getPlaceLocaleFallback(placeSlug)
      : null;

  // Precedence del `lang`:
  //   1. `place.default_locale` — owner con sesión en subdomain canon o custom
  //      domain (Feature C V1: Signed Ticket SSO local, ADR-0032). Autoridad máxima.
  //   2. `hostZone.defaultLocale` — visitor anónimo en CUSTOM DOMAIN; el lookup
  //      S1/S3 ya resolvió el locale configurado por el owner.
  //   3. `anonymousCanonLocale` — visitor anónimo en SUBDOMAIN CANON (S4c,
  //      fuente 2 del ADR-0031). Cierra el "Bug 1" del audit S4.
  //   4. `routing.defaultLocale` — fallback canónico ('es', ADR-0024): slug
  //      inexistente / archivado, host desconocido, error transitorio del lookup.
  const lang =
    place?.defaultLocale ??
    (hostZone.zone === "custom-domain" ? hostZone.defaultLocale : null) ??
    anonymousCanonLocale ??
    routing.defaultLocale;
  const tA11y = await getTranslations({ locale: lang, namespace: "a11y" });

  return (
    <html lang={lang}>
      <body className="antialiased">
        <a href="#contenido" className="skip-link">
          {tA11y("skipToContent")}
        </a>
        {children}
      </body>
    </html>
  );
}
