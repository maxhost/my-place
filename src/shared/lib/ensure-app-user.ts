import { randomBytes } from "node:crypto";
import { cache } from "react";
import type { SqlExecutor } from "./db";

// Identidad mínima provista por la sesión de Neon Auth (auth.getSession()):
// el `sub` (auth_user_id), email y nombre. El wiring del SDK que la resuelve
// es S4b/S5; acá vive el primitivo idempotente.
export interface AppUserIdentity {
  authUserId: string;
  email: string;
  displayName: string;
}

// Handle random no-usado al crear la cuenta (ADR-0002): 128 bits de entropía
// → colisión despreciable a cualquier escala; editable luego por el usuario.
function randomHandle(): string {
  return `u${randomBytes(8).toString("hex")}`;
}

async function ensureAppUserImpl(
  sql: SqlExecutor,
  ident: AppUserIdentity,
): Promise<string> {
  const displayName = ident.displayName.trim() || ident.email.split("@")[0];
  // Idempotente por `auth_user_id UNIQUE`: conflicto → no-op (ADR-0006). El
  // INSERT está sujeto a `au_self` (WITH CHECK
  // app.current_user_id() = auth_user_id) → sólo crea la fila propia.
  const inserted = await sql(
    `INSERT INTO app_user (auth_user_id, email, display_name, handle)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (auth_user_id) DO NOTHING
     RETURNING id`,
    [ident.authUserId, ident.email, displayName, randomHandle()],
  );
  if (inserted.length > 0) return inserted[0].id as string;
  // Ya existía: re-leer (visible por `au_self`, misma identidad del caller).
  const existing = await sql(`SELECT id FROM app_user WHERE auth_user_id = $1`, [
    ident.authUserId,
  ]);
  if (existing.length === 0) {
    throw new Error("ensureAppUser: app_user no visible tras upsert (RLS)");
  }
  return existing[0].id as string;
}

// Dedupe por request (ADR-0006): React.cache memoiza dentro del render del
// RSC tree → varias features que lo invocan en su borde no duplican el
// upsert. Fuera de un render (tests/no-RSC) no memoiza: la idempotencia es,
// igual, garantía de DB (ON CONFLICT), no del cache.
export const ensureAppUser = cache(ensureAppUserImpl);
