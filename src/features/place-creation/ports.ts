import type { SqlExecutor } from "@/shared/lib/db";

// Puertos cross-system de la saga (ADR-0005 §2). La orquestación es pura y
// determinista; el borde con Neon Auth (signUp/token) y la DB se inyectan,
// igual que el seam-split de S4b: el wiring vivo del SDK se verifica en
// preview Vercel, no en vitest (arrastra `next/headers` + Neon vivo).
//
// Phase 1.B — el port `runAuthedTx` se realineó al coordinator zone-aware
// `getAuthenticatedDbForRequest` (ADR-0034): ya no recibe `accessToken` —
// el coordinator detecta zona + lee la cookie correcta internamente. El
// callback sigue recibiendo `claims` con `{sub}` (superset común de
// `VerifiedClaims` Neon Auth + `LocalSessionClaims` SSO local). Cierra el
// último callsite que dependía del patrón pre-ADR-0034 `requireSessionJwt()`
// + `getAuthenticatedDb(token, fn)`.

/**
 * Identidad ya resuelta para la saga. `email`/`displayName` siembran `app_user`
 * sólo si aún no existe (`ensureAppUser` es idempotente por
 * `auth_user_id UNIQUE`).
 *
 * - place-first (CTA): el adapter hace `signUp` y obtiene email/displayName
 *   del input crudo del wizard (la sesión queda persistida vía cookie del
 *   `signUp`, re-legible por el coordinator en la TX subsiguiente).
 * - authed (Acceso → "Crear mi place"): email/displayName salen de la
 *   identidad de la sesión vigente vía `getCurrentUserIdentityForRequest()`
 *   (DEFINER `app.lookup_user_identity_by_id`, zone-aware).
 *
 * `authUserId` NO viaja por este port: el saga lee `claims.sub` (lo VERIFICADO
 * por RLS) dentro del `runAuthedTx`, defense-in-depth contra divergencia
 * identity-vs-claims.
 */
export interface AcquiredIdentity {
  email: string;
  displayName: string;
}

export type AcquireIdentity = () => Promise<AcquiredIdentity>;

/**
 * Corre `fn` en UNA tx autenticada (rol `app_system` + claims tx-local) que
 * commitea al volver o rollbackea si `fn` lanza. La saga lo invoca DOS veces
 * (`ensureAppUser`, luego `app.create_place`): dos invocaciones = dos commits
 * separados → la frontera two-tx de ADR-0005 §4. Firma alineada con
 * `getAuthenticatedDbForRequest` (zone-aware): el coordinator decide branch
 * (Neon Auth en apex/subdomain/inbox vs SSO local en custom domain) y nos
 * pasa el `claims.sub` verificado al callback.
 */
export type AuthedTxRunner = <T>(
  fn: (sql: SqlExecutor, claims: { sub: string }) => Promise<T>,
) => Promise<T>;

export interface CreatePlacePorts {
  acquireIdentity: AcquireIdentity;
  runAuthedTx: AuthedTxRunner;
}
