import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// Neon serverless necesita un WebSocket en Node (en runtime/Vercel ya existe).
neonConfig.webSocketConstructor = ws;

// Pool compartido por los tests de DB. SIEMPRE conecta como `app_system`
// (rol NO-admin, sin BYPASSRLS) vía DATABASE_URL_TEST — nunca el rol admin
// (falso verde por BYPASSRLS, ver tests.md / CLAUDE.md).
export const testPool = new Pool({
  connectionString: process.env.DATABASE_URL_TEST,
});

// Pool admin (DATABASE_URL_TEST_MIGRATE, dueño de las tablas). SOLO lo usa
// `inRlsTx`: el dueño bypasea RLS y puede sembrar el escenario; las
// aserciones de RLS corren tras `SET ROLE app_system` (rol real, sin
// BYPASSRLS) — el patrón canónico de testeo de RLS (seed-as-owner, assert-as-
// restricted, ROLLBACK). NUNCA se asierta bajo el rol admin.
const rlsAdminPool = new Pool({
  connectionString: process.env.DATABASE_URL_TEST_MIGRATE,
});

export type Rows = Promise<Record<string, unknown>[]>;

// Handle de una tx de test de RLS. `seed` corre como dueño (RLS no aplica al
// dueño de la tabla → siembra place/ownership/membership que en runtime sólo
// crearía `app.create_place`). `as` baja a `app_system` e inyecta el claim
// `sub` (null = sin claim). `q` consulta en el rol/claims actuales. `denied`
// envuelve en SAVEPOINT (un stmt fallido aborta la tx en Postgres) y devuelve
// true si la op fue rechazada — siempre revierte el efecto.
export interface RlsTx {
  seed: (text: string, params?: unknown[]) => Rows;
  as: (sub: string | null) => Promise<void>;
  // Inyecta el JSON de claims CRUDO tal cual lo hace `getAuthenticatedDb`
  // (objeto completo: sub+iat+exp), no sólo `{sub}`. `""` = sin claim.
  asRawClaims: (claimsJson: string) => Promise<void>;
  q: (text: string, params?: unknown[]) => Rows;
  denied: (text: string, params?: unknown[]) => Promise<boolean>;
}

// Ejecuta `fn` en una tx que SIEMPRE hace ROLLBACK. Al inicio concede
// `app_system` al rol admin SOLO dentro de la tx (GRANT es transaccional → se
// va con el ROLLBACK): cero footprint en producción, cero estado commiteado.
// Habilita `SET ROLE app_system` / `RESET ROLE` (seed-as-owner / assert-as-
// app_system) sin tocar el modelo de roles de prod.
export async function inRlsTx<T>(fn: (tx: RlsTx) => Promise<T>): Promise<T> {
  const client = await rlsAdminPool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT current_user AS u");
    const adminRole = (rows[0] as { u: string }).u;
    await client.query(`GRANT app_system TO "${adminRole}"`);

    const seed: RlsTx["seed"] = async (text, params) => {
      await client.query("RESET ROLE"); // dueño de la tabla: RLS no aplica
      return (await client.query(text, params)).rows as Record<
        string,
        unknown
      >[];
    };
    const as: RlsTx["as"] = async (sub) => {
      await client.query("RESET ROLE");
      await client.query("SET ROLE app_system");
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        sub === null ? "" : JSON.stringify({ sub }),
      ]);
    };
    const asRawClaims: RlsTx["asRawClaims"] = async (claimsJson) => {
      await client.query("RESET ROLE");
      await client.query("SET ROLE app_system");
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        claimsJson,
      ]);
    };
    const q: RlsTx["q"] = async (text, params) =>
      (await client.query(text, params)).rows as Record<string, unknown>[];
    const denied: RlsTx["denied"] = async (text, params) => {
      await client.query("SAVEPOINT sp");
      let rejected: boolean;
      try {
        await client.query(text, params);
        rejected = false;
      } catch {
        rejected = true;
      }
      await client.query("ROLLBACK TO SAVEPOINT sp");
      await client.query("RELEASE SAVEPOINT sp");
      return rejected;
    };

    return await fn({ seed, as, asRawClaims, q, denied });
  } finally {
    await client.query("RESET ROLE").catch(() => {});
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

export function endRlsAdminPool(): Promise<void> {
  return rlsAdminPool.end();
}

// Ejecuta `fn` dentro de una tx que SIEMPRE hace ROLLBACK: ningún test
// commitea estado al branch `test`. `claims` (JSON string | null) se inyecta
// transaction-local como en runtime (`set_config('request.jwt.claims', …, true)`).
export async function inTx<T>(
  claims: string | null,
  fn: (
    q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>,
  ) => Promise<T>,
): Promise<T> {
  const client = await testPool.connect();
  try {
    await client.query("BEGIN");
    if (claims !== null) {
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        claims,
      ]);
    }
    const result = await fn(
      async (text, params) => (await client.query(text, params)).rows,
    );
    return result;
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
