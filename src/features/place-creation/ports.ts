import type { SqlExecutor } from "@/shared/lib/db";
import type { VerifiedClaims } from "@/shared/lib/jwt";

// Puertos cross-system de la saga (ADR-0005 §2). La orquestación es pura y
// determinista; el borde con Neon Auth (signUp/token) y la DB se inyectan,
// igual que el seam-split de S4b: el wiring vivo del SDK se verifica en
// preview Vercel, no en vitest (arrastra `next/headers` + Neon vivo).

/**
 * Identidad ya resuelta para la saga. `accessToken` es un JWT de Neon Auth
 * verificable; `email`/`displayName` siembran `app_user` sólo si aún no
 * existe (ensureAppUser es idempotente por `auth_user_id UNIQUE`).
 *
 * - place-first (CTA): el adapter hace `signUp` y obtiene el token de la
 *   respuesta (la cookie de `signUp` NO es re-legible en la misma invocación
 *   del Server Action — TBD impl verificado en preview, ADR-0005 §S5b).
 * - authed (Acceso → "Crear mi place"): el token sale de la sesión vigente.
 */
export interface AcquiredIdentity {
  accessToken: string;
  email: string;
  displayName: string;
}

export type AcquireIdentity = () => Promise<AcquiredIdentity>;

/**
 * Corre `fn` en UNA tx autenticada (rol `app_system` + claims tx-local) que
 * commitea al volver o rollbackea si `fn` lanza. La saga lo invoca DOS veces
 * (ensureAppUser, luego `app.create_place`): dos invocaciones = dos commits
 * separados → la frontera two-tx de ADR-0005 §4. Firma = `getAuthenticatedDb`.
 */
export type AuthedTxRunner = <T>(
  accessToken: string,
  fn: (sql: SqlExecutor, claims: VerifiedClaims) => Promise<T>,
) => Promise<T>;

export interface CreatePlacePorts {
  acquireIdentity: AcquireIdentity;
  runAuthedTx: AuthedTxRunner;
}

/**
 * Puerto LLM del servicio de sugerencia de estilo (S10a, ADR-0005 §5 /
 * ADR-0007): a partir de la descripción libre "para quién es el place"
 * devuelve el OBJETO CRUDO del modelo (sin validar) — el dominio lo re-valida
 * con Zod y aplica el guardrail (defensa en profundidad: nunca se confía en
 * el LLM). Mismo seam-split que S5b: el wiring vivo del Vercel AI Gateway se
 * verifica por tipo/build + preview, NO en vitest (arrastra `ai` + red).
 */
export type StyleSuggester = (description: string) => Promise<unknown>;
