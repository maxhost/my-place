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

// Ejecuta `fn` dentro de una tx que SIEMPRE hace ROLLBACK: ningún test
// commitea estado al branch `test`. `claims` (JSON string | null) se inyecta
// transaction-local como en runtime (`set_config('request.jwt.claims', …, true)`).
export async function inTx<T>(
  claims: string | null,
  fn: (q: (text: string, params?: unknown[]) => Promise<unknown[]>) => Promise<T>,
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
