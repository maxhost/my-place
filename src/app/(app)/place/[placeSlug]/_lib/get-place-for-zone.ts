import { headers } from "next/headers";
import { cache } from "react";
import { loadPlaceBySlug, type PlaceData } from "@/features/place/public";
import { lookupPlaceByDomain } from "@/shared/lib/custom-domain-lookup";
import { getAuthenticatedDb } from "@/shared/lib/db";
import {
  type HostZone,
  resolveHostWithCustomDomains,
} from "@/shared/lib/host-routing";
import { lookupPlaceLocaleBySlug } from "@/shared/lib/place-locale-lookup";
import { getSessionJwt } from "@/shared/lib/session";

// Helpers privados del árbol `(app)/place/[placeSlug]/` (S6 del feature
// `settings`, `docs/features/settings/spec.md`). El prefijo `_lib` lo trata
// Next App Router como private folder (no participa del routing — convención
// reconocida del framework, paralela a `__tests__` de vitest). Establece
// patrón para futuros helpers de zona-place que NO sean dominio reusable
// (`features/`) ni primitivos UI agnósticos (`shared/ui/`) — sólo cableado
// del wiring de la zona.
//
// Motivación de existencia: el layout (`<html lang>` dinámico, S6) y la page
// del settings (`/settings/page.tsx`, S6) ambos necesitan el `place` para
// derivar el locale del chrome. Sin dedupe, eso son 2 lecturas de cookie +
// 2 verificaciones JWT + 2 conexiones a Neon + 2 queries SELECT por request
// — costo doble del ratio crítico de carga.
//
// `React.cache()` resuelve el caso: dentro del mismo render del árbol Server
// Component (layout → page), la segunda invocación con los mismos argumentos
// reusa el resultado memoizado. Es Next App Router + React 19 canónico
// (`next.js` 16.2.6 + `react` 19.1.0 en `package.json`). NO es `next/cache`
// (ese es para cache de fetches entre requests); es `react/cache` (per-render
// memoization, mismo lifetime que el árbol React server).
//
// Por qué cachear ambos:
// - `getSessionTokenForZone`: aunque `getSessionJwt()` es cheap (lectura de
//   cookie + token del SDK), el SDK Neon Auth puede hacer fetch internamente
//   para validar. Cachear lo elimina aunque sea barato (production-grade:
//   "no work twice if you can avoid it").
// - `getPlaceForZone`: la query DB es la pesada — la dedup acá es el motivo
//   real del helper. Pero el token también se cachea para que la primera
//   llamada del page (que verifica si hay sesión para decidir redirect) y la
//   llamada interna de `getPlaceForZone` (que necesita el token para la tx
//   autenticada) compartan resultado.
//
// Sobre el shape de retorno: `PlaceData | null`. El consumer distingue las
// causas del `null` mirando primero el token (no-session → redirect; token
// presente + place null → RLS-filtered o slug inexistente → notFound).

/**
 * JWT de sesión cross-subdomain (cookie `.place.community`) memoizado por
 * render. Layout y page lo consumen sin pagar la segunda lectura.
 */
export const getSessionTokenForZone = cache(
  async (): Promise<string | null> => {
    return getSessionJwt();
  },
);

/**
 * Carga el `place` por slug aplicando guards owner-only (RLS + EXISTS sobre
 * `place_ownership`, ver `load-place-by-slug.ts`). Retorna `null` si no hay
 * sesión vigente o si el caller no es owner del place (incluye no-existe y
 * archivado).
 *
 * Memoizado por render: la primera llamada (e.g. desde el layout) abre la
 * tx autenticada y corre la SELECT; las siguientes (e.g. desde el settings
 * page) reusan el `PlaceData` sin re-tocar Neon.
 */
export const getPlaceForZone = cache(
  async (placeSlug: string): Promise<PlaceData | null> => {
    const token = await getSessionTokenForZone();
    if (token === null) return null;
    return getAuthenticatedDb(token, (executor) =>
      loadPlaceBySlug(executor, placeSlug),
    );
  },
);

/**
 * Lookup ANONYMOUS del `default_locale` del place identificado por slug
 * (Feature B S4c, ADR-0031 §"Fuente 2"). Memoizado por render porque
 * múltiples consumidores en la zona pueden necesitarlo:
 *   1. `layout.tsx` — fallback de `<html lang>` cuando el visitor NO tiene
 *      sesión y está en subdomain canon (caso donde `getPlaceForZone`
 *      retorna `null` por RLS owner-only).
 *   2. `settings/page.tsx` y `settings/domain/page.tsx` — el redirect a
 *      login apex ocurre ANTES de cargar `place` (no hay sesión), así que
 *      no tenemos `place.defaultLocale` para el `buildApexLoginUrl`. El
 *      lookup anónimo lo resuelve sin debilitar RLS (`app.lookup_place_
 *      locale_by_slug` SECURITY DEFINER, S4b §SQL, solo expone el escalar
 *      `default_locale` filtrando `archived_at IS NULL`).
 *
 * Wrapper sobre `lookupPlaceLocaleBySlug` (`shared/lib/place-locale-
 * lookup.ts`, S4b). El wrapper subyacente ya tiene fail-safe a `null` y
 * `console.error` para errores DB; este `cache()` solo agrega la
 * dedup intra-render.
 *
 * Retorna `string | null`:
 *   - `string` (uno de los 6 locales operativos validados por Zod del
 *     wrapper S4b).
 *   - `null` cuando: slug no existe en DB, place archivado, query DB falló
 *     (fail-safe), locale fuera del enum (drift TS↔DB, defense-in-depth
 *     del wrapper S4b). El consumer decide el fallback final
 *     (`routing.defaultLocale` en layout, `'es'` en `buildApexLoginUrl`).
 */
export const getPlaceLocaleFallback = cache(
  async (placeSlug: string): Promise<string | null> => {
    return lookupPlaceLocaleBySlug(placeSlug);
  },
);

/**
 * Resuelve la `HostZone` del request actual (Feature B S4d, ADR-0031 §"Auth
 * gate UX"). Wrapper memoizado por render sobre
 * `resolveHostWithCustomDomains` + `lookupPlaceByDomain` — exactamente el
 * mismo cómputo que el layout ya hace para el defensive slug→host check
 * (S3) y para el fallback de `<html lang>` en custom-domain (S3/S4c).
 *
 * `React.cache()` deduplica intra-render: la primera invocación (e.g. en el
 * layout) corre la lectura del header `host` + (potencial) query del lookup
 * SECURITY DEFINER; las siguientes (e.g. desde `settings/page.tsx` para
 * detectar custom-domain y decidir auth-gate vs redirect, S4d) reusan el
 * resultado sin re-tocar la red ni Neon.
 *
 * Política de skip estructural (heredada del wrapper subyacente,
 * `host-routing.ts`): apex / `app.<root>` / `<slug>.<root>` / dev
 * `*.localhost` / `*.vercel.app` NO consultan DB — sólo hosts candidatos
 * reales a custom-domain pagan la query. Hot path V1 ya acotado en ADR-0031.
 *
 * Retorna `HostZone` (nunca tira): el wrapper subyacente colapsa errores
 * a `{zone: "marketing"}` por defense-in-depth. El consumer interpreta:
 *   - `zone === "custom-domain"` → auth-gate UX (S4d).
 *   - otros → redirect a apex login (S4c).
 */
export const getHostZoneForZone = cache(async (): Promise<HostZone> => {
  const hostHeader = (await headers()).get("host") ?? "";
  return resolveHostWithCustomDomains(
    hostHeader,
    undefined,
    lookupPlaceByDomain,
  );
});
