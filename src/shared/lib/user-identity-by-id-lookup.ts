import { z } from "zod";

import type { SqlExecutor } from "@/shared/lib/db";
import { log } from "@/shared/lib/observability/log";

// Feature E — Invite Accept Flow V1.2 · Sesión D.fix.3 (ADR-0046 §"Addendum
// operacional — Sesión D.fix.3", migration 0024). Wrapper TS sobre
// `app.lookup_user_identity_by_id` SECURITY DEFINER.
//
// Diferencia vs `lookupUserEmailById` (D.fix.1, supersede por este wrapper):
// retorna identidad mínima `{email, name}` en lugar de sólo email. Habilita
// que el integrator `getCurrentUserIdentityForRequest` (`shared/lib/current-
// user-identity.ts`) cierre el último callsite de `getAuth().getSession()` con
// riesgo zone-aware: `acceptInvitationAction` que necesita ambos (email +
// displayName) para `ensureAppUser`.
//
// Se invoca DENTRO de una tx autenticada del coordinator
// `getAuthenticatedDbForRequest` (ADR-0034), NO via `pool` global. Recibe el
// `SqlExecutor` ya wired-up con claims tx-local (`request.jwt.claims`) que el
// integrator le pasa via callback. Esto permite que el helper sea zone-aware
// sin acoplarse al detalle de qué cookie se está leyendo en cada zona — el
// coordinator decide. Por el mismo motivo, NO usa `React.cache`: el sub
// (uuid) es runtime-derived y la tx es per-invocación.
//
// ## Invariantes
//
//   1. Cast explícito `::uuid` en el bind: la columna `neon_auth.user.id`
//      es UUID; pasar el JWT claim `sub` como string requiere cast explícito
//      o Postgres tira "operator does not exist: uuid = text". Defense-in-
//      depth contra drift del SqlExecutor.
//   2. Zod parse `z.object({email: z.string().min(1), name: z.string()})`:
//      defense-in-depth ante drift de schema (NULL inesperado, tipo no-
//      objeto, faltan campos). El name es NOT NULL en `neon_auth.user`
//      (Better Auth schema) → `z.string()` sin `.nullable()`. El email tiene
//      `.min(1)` para detectar string vacío (drift extremo).
//   3. Fail-safe: errores de DB (timeout, network, función no existe por
//      drift de schema, sub UUID inválido por bug del coordinator) NO
//      colapsan a null acá — bubblean al integrator. El integrator decide
//      la semántica (silenciar para invite page reader; propagar error code
//      para Server Action).
//   4. NO short-circuit por sub vacío: el coordinator garantiza que claims.sub
//      es string no-vacío via `decideAuthBranch`/`verifyLocalSession`. Drift
//      de coordinator → query con sub vacío → Postgres tira "invalid input
//      syntax for type uuid" → bubble al integrator (NO silent null acá,
//      para que el bug del coordinator sea detectable).

const identitySchema = z.object({
  email: z.string().min(1),
  name: z.string(),
});

export type UserIdentity = z.infer<typeof identitySchema>;

export async function lookupUserIdentityById(
  sql: SqlExecutor,
  authUserId: string,
): Promise<UserIdentity | null> {
  const rows = await sql(
    "SELECT app.lookup_user_identity_by_id($1::uuid) AS payload",
    [authUserId],
  );
  const raw = rows[0]?.payload;
  if (raw === null || raw === undefined) return null;
  const parsed = identitySchema.safeParse(raw);
  if (!parsed.success) {
    log.error(
      parsed.error,
      { scope: "user-identity-by-id-lookup", authUserId },
      "payload inválido",
    );
    return null;
  }
  return parsed.data;
}
