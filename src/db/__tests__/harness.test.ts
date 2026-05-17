import { afterAll, describe, expect, it } from "vitest";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// Neon serverless necesita un WebSocket en Node (en runtime/Vercel ya existe).
neonConfig.webSocketConstructor = ws;

// S0 harness: valida el fundamento de RLS sobre el branch `test`, conectado
// como `app_system` (rol NO-admin), con el patrón real (tx interactiva +
// set_config transaction-local). Prueba ADR-0011 end-to-end.
const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });

afterAll(() => pool.end());

async function inTx<T>(
  claims: string | null,
  fn: (q: (text: string) => Promise<unknown[]>) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (claims !== null) {
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        claims,
      ]);
    }
    const result = await fn(async (text) => (await client.query(text)).rows);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

describe("S0 harness — RLS foundation (ADR-0011)", () => {
  it("conecta como app_system (no-admin, sin BYPASSRLS)", async () => {
    const rows = (await inTx(null, (q) =>
      q(
        "SELECT current_user AS role, rolbypassrls FROM pg_roles WHERE rolname = current_user",
      ),
    )) as Array<{ role: string; rolbypassrls: boolean }>;
    expect(rows[0].role).toBe("app_system");
    expect(rows[0].rolbypassrls).toBe(false);
  });

  it("app.current_user_id() devuelve el claim `sub` inyectado", async () => {
    const rows = (await inTx('{"sub":"user-abc"}', (q) =>
      q("SELECT app.current_user_id() AS who"),
    )) as Array<{ who: string | null }>;
    expect(rows[0].who).toBe("user-abc");
  });

  it("app.current_user_id() es NULL sin claim (la policy denegaría)", async () => {
    const rows = (await inTx(null, (q) =>
      q("SELECT app.current_user_id() AS who"),
    )) as Array<{ who: string | null }>;
    expect(rows[0].who).toBeNull();
  });
});
