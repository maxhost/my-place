import type { PoolClient } from "@neondatabase/serverless";
import { pool } from "@/db/client";
import { type VerifiedClaims, verifyAccessToken } from "./jwt";
import { obs, obsErr } from "./obs";

// Ejecutor SQL parametrizado (posicional, estilo node-postgres) sobre la tx
// autenticada. Los seams de seguridad (ensureAppUser, aceptación de
// invitación) usan SQL parametrizado a mano — misma convención que las
// funciones SECURITY DEFINER (ADR-0012); Drizzle sigue siendo SoT de
// schema/RLS. Las queries de feature usan su propia capa (por-feature).
export type SqlExecutor = (
  text: string,
  params?: unknown[],
) => Promise<Record<string, unknown>[]>;

// Costura sesión→claims→RLS (ADR-0006/0011). Verifica el access token
// (fail-closed: ANTES de abrir conexión/tx), abre una tx interactiva con el
// rol `app_system`, inyecta los claims COMPLETOS tx-local
// (`set_config('request.jwt.claims', …, true)` — `true` OBLIGATORIO: con el
// pooler de Neon omitirlo filtraría identidad entre requests) y corre `fn`.
// Las policies leen app.current_user_id() (->>'sub'). El token lo provee el
// caller vía `auth.getAccessToken()` (Neon Auth) — wiring del SDK en S4b.
export async function getAuthenticatedDb<T>(
  accessToken: string,
  fn: (sql: SqlExecutor, claims: VerifiedClaims) => Promise<T>,
): Promise<T> {
  let claims: VerifiedClaims;
  try {
    claims = await verifyAccessToken(accessToken);
  } catch (err) {
    obsErr("db:verifyToken", err);
    throw err;
  }
  obs("db:verifyToken-ok", { sub: claims.sub });

  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (err) {
    obsErr("db:poolConnect", err);
    throw err;
  }
  obs("db:connected");
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
    obsErr("db:tx", err);
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
