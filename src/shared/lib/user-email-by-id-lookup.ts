import { z } from "zod";

import type { SqlExecutor } from "@/shared/lib/db";

// Feature E — Invite Accept Flow V1.2 · Sesión D.fix (ADR-0046 §"Addendum
// operacional — Sesión D", migration 0023). Wrapper TS sobre
// `app.lookup_user_email_by_id` SECURITY DEFINER.
//
// Diferencia vs `lookupCustomDomainBySlug` (Sesión A, paralelo):
// éste se invoca DENTRO de una tx autenticada del coordinator
// `getAuthenticatedDbForRequest` (ADR-0034), NO via `pool` global. Recibe el
// `SqlExecutor` ya wired-up con claims tx-local (`request.jwt.claims`) que el
// integrator (`current-user-email.ts`) le pasa via callback. Esto permite
// que el helper sea zone-aware sin acoplarse al detalle de qué cookie se
// está leyendo en cada zona — el coordinator decide.
//
// Por el mismo motivo, NO usa `React.cache`: el coordinator
// `getAuthenticatedDbForRequest` crea una nueva tx por invocación y el sub
// (uuid) es runtime-derived; la memoización (si aplica) la decide el
// integrator, no este wrapper.
//
// ## Invariantes
//
//   1. Cast explícito `::uuid` en el bind: la columna `neon_auth.user.id`
//      es UUID; pasar el JWT claim `sub` como string requiere cast explícito
//      o Postgres tira "operator does not exist: uuid = text". Defense-in-
//      depth contra drift del SqlExecutor.
//   2. Zod parse `z.string().min(1)`: defense-in-depth ante NULL inesperado,
//      tipo no-string, string vacío. El email shape valida formato a nivel
//      Neon Auth (constraint NOT NULL en `neon_auth.user`); acá sólo "es
//      string no vacío".
//   3. Fail-safe: errores de DB (timeout, network, función no existe por
//      drift de schema, sub UUID inválido por bug del coordinator) NO
//      colapsan a null acá — bubblean al integrator. El integrator decide
//      la semántica (silenciar para invite page, propagar para consumers
//      futuros que requieran fail-closed).
//   4. NO short-circuit por sub vacío: el coordinator garantiza que claims.sub
//      es string no-vacío via `decideAuthBranch`/`verifyLocalSession`. Drift
//      de coordinator → query con sub vacío → Postgres tira "invalid input
//      syntax for type uuid" → bubble al integrator (NO silent null acá,
//      para que el bug del coordinator sea detectable).

const emailSchema = z.string().min(1);

export async function lookupUserEmailById(
  sql: SqlExecutor,
  authUserId: string,
): Promise<string | null> {
  const rows = await sql(
    "SELECT app.lookup_user_email_by_id($1::uuid) AS email",
    [authUserId],
  );
  const raw = rows[0]?.email;
  if (raw === null || raw === undefined) return null;
  const parsed = emailSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(
      "[user-email-by-id-lookup] email inválido para id=",
      authUserId,
      parsed.error,
    );
    return null;
  }
  return parsed.data;
}
