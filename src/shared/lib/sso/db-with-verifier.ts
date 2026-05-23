import { pool } from "@/db/client";
import type { SqlExecutor } from "@/shared/lib/db";

// Feature C · S4 · db-with-verifier: bridge sesión-local-del-custom-domain
// → claims tx-local → RLS. ADR-0032 §"Decisión 6 — RLS continuity via
// injected verifier".
//
// ## Por qué un módulo separado (y NO modificar `db.ts`)
//
// El módulo `shared/lib/db.ts` (Feature A) sirve al apex: el `accessToken`
// es JWT de Neon Auth verificado contra JWKS remoto. Está LOCKED — modificar
// su firma rompería la invariante "cada zona tiene su propia costura
// sesión→claims". El custom domain tiene un JWT DISTINTO (signed por
// nosotros, no por Neon Auth) → requiere su propia costura.
//
// Esta bridge es ESTRUCTURALMENTE idéntica a `getAuthenticatedDb`:
//   1. Verifica el token (fail-closed: ANTES de adquirir conexión).
//   2. Abre tx interactiva bajo `app_system`.
//   3. Inyecta `request.jwt.claims` tx-local (flag `true` OBLIGATORIO — el
//      pooler de Neon filtraría identidad entre requests sin él).
//   4. Corre `fn(sql, claims)`.
//   5. COMMIT en happy path / ROLLBACK en throw.
//
// La diferencia: el verifier es INYECTABLE (no hardcodea Neon Auth). V1
// pasa `verifyLocalSession` wrappeada para extraer `{sub}`; V2 podría pasar
// otros verifiers (e.g. para sesiones del inbox cross-place — fuera de
// scope V1).
//
// ## Continuidad RLS
//
// El `sub` del local session JWT === `neon_auth.user.id` (garantizado por
// el redeem S8: el `sub` del ticket = `sub` del Neon Auth JWT que el apex
// verificó en `sso-issue`). RLS lee `app.current_user_id()` que extrae
// `->>'sub'` del claims JSON — ve la MISMA identidad que vería en apex.
// Cero refactor de policies necesario.
//
// ## Invariantes
//
// 1. **Fail-closed real.** `verifier(token)` se invoca ANTES de `pool.connect()`.
//    Token inválido → no DB touch, no logs spurios de conexión.
// 2. **Tx-local claims.** `set_config('request.jwt.claims', $1, true)` —
//    el `true` es el flag tx-local de Postgres `set_config`. Sin él, la
//    config persiste a nivel session → con pooling de Neon, OTRO request
//    podría heredar la identidad. **Crítico de seguridad.**
// 3. **Mínima superficie.** El verifier retorna `{sub}` (subset estructural
//    de `LocalSessionClaims`, `VerifiedClaims`, etc.). Cualquier shape que
//    incluya `sub: string` es válido — los claims extra se serializan al
//    JSON pero RLS solo lee `sub`.
// 4. **Mismo rol DB.** El pool corre como `app_system` (sin BYPASSRLS) —
//    idéntico a `getAuthenticatedDb`. RLS policies aplican.

/**
 * Verifier inyectable: cualquier función que dado un token retorne un
 * objeto con al menos `{sub: string}`. La bridge serializa el objeto
 * entero como `request.jwt.claims`; RLS solo lee `->>'sub'`, claims extra
 * son no-op pero deben ser JSON-serializables.
 *
 * V1 wrapper canónico: `(token) => verifyLocalSession({token, expectedHost})`
 * donde `expectedHost` se cierra sobre el host del request (S9).
 */
export type TokenVerifier = (token: string) => Promise<{ sub: string }>;

/**
 * Bridge sesión-local → claims → RLS. Paralelo estructural a
 * `getAuthenticatedDb` (apex) con verifier inyectable.
 *
 * Contract:
 *   - `token`: opaque al bridge (lo entiende solo el verifier).
 *   - `verifier`: validador puro (no toca DB) que retorna `{sub}`.
 *   - `fn`: callback con `sql` ejecutor parametrizado + claims verificadas.
 *
 * Errores:
 *   - Verifier throws → bridge re-throws sin tocar pool.
 *   - `fn` throws → ROLLBACK + re-throw.
 *   - Pool error → re-throw (caller maneja).
 */
export async function getAuthenticatedDbWithVerifier<T>(
  token: string,
  verifier: TokenVerifier,
  fn: (sql: SqlExecutor, claims: { sub: string }) => Promise<T>,
): Promise<T> {
  const claims = await verifier(token);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(claims),
    ]);
    const exec: SqlExecutor = async (text, params) =>
      (await client.query(text, params)).rows as Record<string, unknown>[];
    const result = await fn(exec, claims);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
