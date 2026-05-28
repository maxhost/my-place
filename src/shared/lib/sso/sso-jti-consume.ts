import { z } from "zod";
import { pool } from "@/db/client";
import { log } from "@/shared/lib/observability/log";

// Feature C · S8 · wrapper anonymous-safe sobre `app.consume_sso_jti`
// (DEFINER, migration 0011). Único canal anti-replay del ticket SSO. ADR-0032
// §"Decisión 1". Pattern paralelo a `custom-domain-lookup.ts`: `pool.query`
// directo (el redeem corre sin sesión local todavía) + Zod parse + fail-safe.
// **Fail-secure**: DB error → `false` (nunca `true` — sería SECURITY HOLE
// replay infinito). `jti` NO se loggea: defense-in-depth contra log scraping.

const consumeResultSchema = z.object({ consume_sso_jti: z.boolean() });

export async function consumeSsoJti(
  jti: string,
  exp: Date,
): Promise<boolean> {
  try {
    const result = await pool.query<{ consume_sso_jti: unknown }>(
      "SELECT app.consume_sso_jti($1, $2) AS consume_sso_jti",
      [jti, exp.toISOString()],
    );
    const row = result.rows[0];
    if (!row) {
      log.error(
        new Error("empty result rows"),
        { scope: "sso-jti-consume" },
        "empty result rows",
      );
      return false;
    }
    const parsed = consumeResultSchema.safeParse(row);
    if (!parsed.success) {
      log.error(
        parsed.error,
        { scope: "sso-jti-consume" },
        "payload schema drift",
      );
      return false;
    }
    return parsed.data.consume_sso_jti;
  } catch (err) {
    log.error(err, { scope: "sso-jti-consume" }, "DB query failed");
    return false;
  }
}
