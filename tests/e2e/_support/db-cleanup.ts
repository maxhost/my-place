import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// Neon serverless necesita un WebSocket en Node (en el runner de Playwright no
// existe global). Mismo patrón que src/db/__tests__/db-test-pool.ts.
neonConfig.webSocketConstructor = ws;

// Patrón de email que identifica TODA cuenta sembrada por los E2E. Cada spec
// DEBE crear cuentas con este prefijo (ver docs/testing.md §"Convención de
// datos de test") para que el barrido del teardown las matchee sin tocar data
// real del branch `test`. El `%` es el comodín de SQL LIKE.
export const E2E_EMAIL_PATTERN = "e2e-%@example.com";

export interface CleanupResult {
  places: number;
  users: number;
}

// Barre TODA la data de dominio creada por los E2E (matching el patrón de
// email), en orden FK-safe (las FK son ON DELETE NO ACTION — hay que borrar
// hijos antes que padres). Conecta con el rol admin (neondb_owner, BYPASSRLS,
// dueño de las tablas) vía DATABASE_URL_MIGRATE: `app_system` NO podría porque
// place_ownership es WORM-via-DEFINER (ADR-0035) + el resto es RLS owner-only.
//
// Idempotente: barre también huérfanos de runs que crashearon antes de su
// teardown. Por eso el globalSetup lo corre como pre-clean defensivo además del
// globalTeardown post-run.
export async function cleanupE2EData(): Promise<CleanupResult> {
  const url = process.env.DATABASE_URL_MIGRATE;
  if (!url) {
    throw new Error(
      "DATABASE_URL_MIGRATE ausente — requerida para el cleanup E2E. " +
        "Copiá .env.e2e.example a .env.e2e y completá las creds del branch test " +
        "(ver docs/testing.md).",
    );
  }

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Places fundados U owned por usuarios de test → temp table reusable. Cubre
    // el caso "cuenta sin place" (founder sin row) y el normal (founder + owner).
    await client.query(
      `CREATE TEMP TABLE _e2e_places ON COMMIT DROP AS
         SELECT DISTINCT p.id
           FROM place p
          WHERE p.founder_user_id IN (
                  SELECT id FROM app_user WHERE email LIKE $1)
             OR p.id IN (
                  SELECT po.place_id
                    FROM place_ownership po
                    JOIN app_user au ON au.id = po.user_id
                   WHERE au.email LIKE $1)`,
      [E2E_EMAIL_PATTERN],
    );

    // Orden FK-safe: hijos → padres. invitation/membership/place_ownership/
    // place_domain referencian place; membership/place_ownership referencian
    // app_user.
    await client.query(
      `DELETE FROM invitation WHERE place_id IN (SELECT id FROM _e2e_places)`,
    );
    await client.query(
      `DELETE FROM membership
         WHERE place_id IN (SELECT id FROM _e2e_places)
            OR user_id IN (SELECT id FROM app_user WHERE email LIKE $1)`,
      [E2E_EMAIL_PATTERN],
    );
    await client.query(
      `DELETE FROM place_ownership
         WHERE place_id IN (SELECT id FROM _e2e_places)
            OR user_id IN (SELECT id FROM app_user WHERE email LIKE $1)`,
      [E2E_EMAIL_PATTERN],
    );
    await client.query(
      `DELETE FROM place_domain WHERE place_id IN (SELECT id FROM _e2e_places)`,
    );
    const placesRes = await client.query(
      `DELETE FROM place WHERE id IN (SELECT id FROM _e2e_places)`,
    );
    const usersRes = await client.query(
      `DELETE FROM app_user WHERE email LIKE $1`,
      [E2E_EMAIL_PATTERN],
    );

    await client.query("COMMIT");

    // `neon_auth."user"` es un schema GESTIONADO por Neon Auth (la cuenta real
    // vive en el backend de Stack Auth, no es 100% SQL-deletable). El sweep es
    // best-effort: como cada spec usa un email único (timestamp), un leftover
    // acá NO rompe runs futuros — es sólo higiene. Si el rol no tiene DELETE
    // sobre el schema gestionado, se loggea y sigue (no bloquea el teardown).
    try {
      await client.query(`DELETE FROM neon_auth."user" WHERE email LIKE $1`, [
        E2E_EMAIL_PATTERN,
      ]);
    } catch (err) {
      console.warn(
        `[e2e cleanup] sweep best-effort de neon_auth."user" falló ` +
          `(no bloqueante, emails únicos garantizan aislamiento): ${
            err instanceof Error ? err.message : String(err)
          }`,
      );
    }

    return {
      places: placesRes.rowCount ?? 0,
      users: usersRes.rowCount ?? 0,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}
