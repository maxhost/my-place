import { cookies, headers } from "next/headers";

import { lookupPlaceByDomain } from "@/shared/lib/custom-domain-lookup";
import { type SqlExecutor, getAuthenticatedDb } from "@/shared/lib/db";
import { resolveHostWithCustomDomains } from "@/shared/lib/host-routing";
import { getSessionJwt } from "@/shared/lib/session";
import {
  getAuthenticatedDbWithVerifier,
  verifyLocalSession,
} from "@/shared/lib/sso";

import {
  NoSessionError,
  decideAuthBranch,
} from "./db-for-request-decision";

// Feature C · S11.2.A · `getAuthenticatedDbForRequest`: helper auto-zone-aware
// para Server Actions y callers que se ejecutan sin saber a priori en qué
// zona corren. Cierra el bug T1.2 (smoke production 2026-05-23): 4 funciones
// servidas desde `/settings` leían SOLO la cookie Neon Auth (cross-subdomain
// `.place.community`), que NO existe en custom domains por RFC 6265.
//
// ## Por qué un helper request-level (y no solo db.ts/db-with-verifier.ts)
//
// `db.ts:getAuthenticatedDb(token, fn)` (Feature A) requiere que el caller le
// pase el token Neon Auth ya leído. `sso/db-with-verifier.ts:getAuthenticated
// DbWithVerifier(token, verifier, fn)` (Feature C S4) requiere que el caller
// le pase el token SSO ya leído + el verifier ya construido. Ambos son
// PRIMITIVOS: están bien (no se modifican). Lo que faltaba es la capa
// COORDINADORA que detecte la zona, lea la cookie correcta y enrute al
// primitivo adecuado.
//
// El precedente vivo es `getSessionTokenForZone`/`getPlaceForZone` (S9, en
// `_lib/get-place-for-zone.ts`), pero ese helper está atado al árbol
// `(app)/place/[placeSlug]/_lib/` (private folder de Next App Router) y vive
// con `React.cache()` (dedup intra-render). Server Actions corren en otra
// invocación HTTP, no en el render tree — necesitan un helper paralelo,
// sin `React.cache()`, sin asumir que el slug viene del path.
//
// ## Continuidad RLS
//
// Ambos branches (sso-local y neon-auth) terminan inyectando `{sub}` como
// `request.jwt.claims` tx-local. `app.current_user_id()` retorna el MISMO
// valor en custom domain que en apex porque el `sub` del local session JWT
// === `sub` del Neon Auth JWT que el apex verificó en `sso-issue`. Cero
// refactor de policies.
//
// ## Invariantes
//
// 1. **Fail-closed real.** Cualquier path sin sesión válida → `NoSessionError`
//    ANTES de tocar el pool. El caller (Server Action) catchea y retorna
//    `{status: 'error'}` UX-equivalente.
// 2. **Defense-in-depth host claim.** En sso-local, el verifier chequea
//    `host` claim === host actual del request (defense contra cookie robada
//    re-presentada en otro custom domain).
// 3. **Seam-split testing.** El integrador `getAuthenticatedDbForRequest`
//    cruza `next/headers` + Neon Auth SDK + DB → NO vitest. Solo
//    `decideAuthBranch` (puro, en `db-for-request-decision.ts`) es
//    vitest-testeable. Convención canon del codebase
//    (`update-default-locale.ts:13`).

// Re-exports estables para que los consumers tengan UN solo import path
// (`@/shared/lib/db-for-request`). El split puro/impuro es interno.
export {
  type AuthBranchDecision,
  type CookieJarLike,
  NoSessionError,
  decideAuthBranch,
} from "./db-for-request-decision";

/**
 * Integrador async: detecta zona del request, decide branch, lee el token
 * correcto, abre tx autenticada con claims tx-local y corre `fn`. El caller
 * (Server Action o RSC con efectos) NO necesita saber en qué zona corre.
 *
 * Pipeline:
 *  1. Lee `host` header + `cookies()` (next/headers).
 *  2. Normaliza host (lowercase, trim puerto) → `expectedHost`.
 *  3. `resolveHostWithCustomDomains(hostHeader, undefined, lookupPlaceByDomain)`
 *     → `HostZone` (custom-domain si verified, marketing/place/inbox sino).
 *  4. `decideAuthBranch` → `AuthBranchDecision`.
 *  5. Branch:
 *     - `no-session` → throw `NoSessionError`.
 *     - `sso-local` → `getAuthenticatedDbWithVerifier` con verifier que
 *       invoca `verifyLocalSession({token, expectedHost})` y extrae `sub`.
 *     - `neon-auth-needed` → `getSessionJwt()` (null → `NoSessionError`),
 *       luego `getAuthenticatedDb(token, fn)`.
 *
 * El callback `fn` recibe `claims: {sub: string}` — superset estructural
 * mínimo común a `VerifiedClaims` (Neon Auth) y `LocalSessionClaims` (SSO).
 * Esto deja al callsite agnóstico de qué primitivo se usó adentro.
 */
export async function getAuthenticatedDbForRequest<T>(
  fn: (sql: SqlExecutor, claims: { sub: string }) => Promise<T>,
): Promise<T> {
  const hostHeader = (await headers()).get("host") ?? "";
  const expectedHost = hostHeader.split(":")[0]?.trim().toLowerCase() ?? "";
  const hostZone = await resolveHostWithCustomDomains(
    hostHeader,
    undefined,
    lookupPlaceByDomain,
  );
  const cookieJar = await cookies();
  const decision = decideAuthBranch(hostZone, cookieJar, expectedHost);

  if (decision.kind === "no-session") {
    throw new NoSessionError();
  }

  if (decision.kind === "sso-local") {
    return getAuthenticatedDbWithVerifier(
      decision.token,
      async (token) => {
        const claims = await verifyLocalSession({
          token,
          expectedHost: decision.expectedHost,
        });
        return { sub: claims.sub };
      },
      fn,
    );
  }

  // decision.kind === "neon-auth-needed"
  const token = await getSessionJwt();
  if (!token) throw new NoSessionError();
  return getAuthenticatedDb(token, fn);
}
