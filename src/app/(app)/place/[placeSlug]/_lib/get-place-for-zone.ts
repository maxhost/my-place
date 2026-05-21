import { cache } from "react";
import { loadPlaceBySlug, type PlaceData } from "@/features/place/public";
import { getAuthenticatedDb } from "@/shared/lib/db";
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
