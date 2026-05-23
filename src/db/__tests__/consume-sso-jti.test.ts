import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";

// Feature C · S1 (ADR-0032 §"Decisión 1") — `app.consume_sso_jti(text,
// timestamptz)` SECURITY DEFINER. Único canal anti-replay del ticket SSO:
// el handler `/api/auth/sso-redeem` lo invoca con el `jti` extraído del
// ticket JWT; la función retorna `true` la primera vez (jti consumido OK)
// y `false` en cualquier reintento (replay detectado).
//
// La tabla `app.sso_jti_used` tiene RLS ENABLE pero CERO policies → ningún
// rol puede SELECT/INSERT directo (verificado por el test "RLS regression").
// La función DEFINER es el único canal seguro (precedente: 0009
// `lookup_place_by_domain` para `place_domain`).
//
// Pattern test: mismo seed-as-owner / assert-as-app_system de los tests
// anteriores (`create-place.test.ts`, `lookup-place-by-domain.test.ts`).
// El caller real del redeem es ANÓNIMO (visitor sin sesión local todavía)
// → invocamos con claim NULL (`tx.as(null)`).

afterAll(() => endRlsAdminPool());

// Helper: invoca `app.consume_sso_jti` como caller anonymous (claim vacío,
// mismo wire que el redeem desde el custom domain sin sesión local).
async function consumeAsAnonymous(
  tx: RlsTx,
  jti: string,
  exp: Date,
): Promise<boolean> {
  await tx.as(null); // claim vacío — sin `sub` (visitor sin sesión local)
  const rows = (await tx.q(
    `SELECT app.consume_sso_jti($1, $2) AS consumed`,
    [jti, exp.toISOString()],
  )) as Array<{ consumed: boolean }>;
  return rows[0].consumed;
}

// jti random — testeable sin acoplarse a un formato específico (UUID hoy,
// opaque base64url posible V2). La PK acepta cualquier TEXT.
function randomJti(prefix = "test-jti"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 18)}`;
}

// `exp` futuro razonable (60s = ticket TTL canónico de Feature C). Lo
// pasamos como Date; el wrapper TS de S8 lo convierte desde epoch seconds.
function futureExp(secondsFromNow = 60): Date {
  return new Date(Date.now() + secondsFromNow * 1000);
}

describe("S1 app.consume_sso_jti — DEFINER anti-replay (ADR-0032 §Decisión 1)", () => {
  it("happy path: primera consume del jti retorna true", async () => {
    await inRlsTx(async (tx) => {
      const jti = randomJti();
      const consumed = await consumeAsAnonymous(tx, jti, futureExp());
      expect(consumed).toBe(true);
      // Defense-in-depth: verificar que efectivamente se insertó (como
      // owner; el caller app_system no puede ver la tabla por RLS).
      const rows = (await tx.seed(
        `SELECT jti FROM app.sso_jti_used WHERE jti = $1`,
        [jti],
      )) as Array<{ jti: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].jti).toBe(jti);
    });
  });

  it("replay: segunda consume del mismo jti retorna false (anti-replay)", async () => {
    // Invariante central de Feature C: un ticket que ya fue redeemed NO
    // puede generar otra sesión local. El handler /sso-redeem recibe el
    // false y responde `?sso_error=replay` → user ve el fallback panel.
    await inRlsTx(async (tx) => {
      const jti = randomJti();
      const exp = futureExp();
      const first = await consumeAsAnonymous(tx, jti, exp);
      const second = await consumeAsAnonymous(tx, jti, exp);
      expect(first).toBe(true);
      expect(second).toBe(false);
    });
  });

  it("replay con exp distinto: segunda consume sigue retornando false (PK = jti, no jti+exp)", async () => {
    // Hardening: aún si el atacante intenta replay con un `exp` "renovado"
    // (e.g. forjando otro ticket con el mismo jti pero exp futuro), la PK
    // sobre `jti` solo lo bloquea por igualdad de jti, no de exp.
    await inRlsTx(async (tx) => {
      const jti = randomJti();
      const first = await consumeAsAnonymous(tx, jti, futureExp(60));
      const second = await consumeAsAnonymous(tx, jti, futureExp(3600));
      expect(first).toBe(true);
      expect(second).toBe(false);
    });
  });

  it("GC oportunista: consume nuevo limpia jtis ya expirados", async () => {
    // Garantía: la tabla no crece sin techo. Cada consume hace
    // `DELETE WHERE expires_at < now()` antes del INSERT. Verificamos que
    // tras un consume nuevo, las filas viejas (expires_at en el pasado)
    // desaparecieron.
    await inRlsTx(async (tx) => {
      // Sembrar 3 filas expiradas (como owner, RLS no aplica).
      await tx.seed(
        `INSERT INTO app.sso_jti_used (jti, expires_at) VALUES
         ('stale-1', now() - interval '1 hour'),
         ('stale-2', now() - interval '30 minutes'),
         ('stale-3', now() - interval '1 minute')`,
      );
      const beforeRows = (await tx.seed(
        `SELECT count(*)::int AS n FROM app.sso_jti_used`,
      )) as Array<{ n: number }>;
      expect(beforeRows[0].n).toBe(3);

      // Consume nuevo dispara GC oportunista.
      const fresh = randomJti();
      const consumed = await consumeAsAnonymous(tx, fresh, futureExp());
      expect(consumed).toBe(true);

      // Las 3 stale deben haber sido borradas; solo queda la fresca.
      const afterRows = (await tx.seed(
        `SELECT jti FROM app.sso_jti_used ORDER BY jti`,
      )) as Array<{ jti: string }>;
      expect(afterRows).toHaveLength(1);
      expect(afterRows[0].jti).toBe(fresh);
    });
  });

  it("DEFINER bypass: caller app_system sin claim (anonymous) ejecuta el INSERT sin RLS deny", async () => {
    // Clave de seguridad: el redeem del custom domain corre SIN sesión
    // local todavía (la está construyendo). El caller es `app_system` con
    // claim vacío. Sin DEFINER, el INSERT directo daría 0 rows (RLS ENABLE
    // + sin policies = deny all). Con DEFINER, el dueño (`neondb_owner`,
    // BYPASSRLS) hace el INSERT por el caller — el caller mantiene rol
    // `app_system` sin claim, pero recibe `true`.
    await inRlsTx(async (tx) => {
      const jti = randomJti();
      // Confirmar que NO hay claim seteado (anonymous absoluto).
      await tx.as(null);
      const [whoami] = (await tx.q(
        `SELECT current_user AS role,
                nullif(current_setting('request.jwt.claims', true), '') AS claims`,
      )) as Array<{ role: string; claims: string | null }>;
      expect(whoami.role).toBe("app_system");
      expect(whoami.claims).toBeNull();
      // La función completa el INSERT pese a no haber claim.
      const rows = (await tx.q(
        `SELECT app.consume_sso_jti($1, $2) AS consumed`,
        [jti, futureExp().toISOString()],
      )) as Array<{ consumed: boolean }>;
      expect(rows[0].consumed).toBe(true);
    });
  });

  it("defense-in-depth: SELECT/INSERT directos sobre app.sso_jti_used (sin DEFINER) → permission denied", async () => {
    // Verifica que el DEFINER NO debilitó la base. La defensa es DOBLE:
    //   (a) Privilege layer: la tabla es owned por `neondb_owner` y no
    //       hay GRANT a `app_system` (precedente Feature B-S1: el patrón
    //       de tablas accesibles SOLO vía función DEFINER no se concede
    //       directamente al rol runtime). El SELECT/INSERT directo lanza
    //       `permission denied for table sso_jti_used` ANTES de evaluar
    //       RLS.
    //   (b) RLS layer (redundante): aún si por bug futuro alguien agrega
    //       GRANT a `app_system`, la tabla tiene RLS ENABLE sin policies
    //       → cualquier query matchea 0 rows (no exception en SELECT,
    //       0 rows affected en INSERT).
    // Resultado V1: el SELECT/INSERT directo CRASHEAN con privilege error,
    // que es el feedback más fuerte (visible inmediato vs deny silencioso).
    // La función DEFINER `app.consume_sso_jti` es el único canal funcional.
    await inRlsTx(async (tx) => {
      // Sembrar una fila como owner (BYPASSRLS) para que haya algo "real"
      // detrás del privilege deny.
      await tx.seed(
        `INSERT INTO app.sso_jti_used (jti, expires_at)
         VALUES ('seeded-by-owner', now() + interval '1 hour')`,
      );
      await tx.as(null); // anonymous app_system
      // SELECT directo: rechazado por privilege (no GRANT SELECT a app_system).
      const selectRejected = await tx.denied(
        `SELECT jti FROM app.sso_jti_used WHERE jti = 'seeded-by-owner'`,
      );
      expect(selectRejected).toBe(true);
      // INSERT directo: rechazado por privilege (no GRANT INSERT a app_system).
      const insertRejected = await tx.denied(
        `INSERT INTO app.sso_jti_used (jti, expires_at)
         VALUES ('direct-insert-attempt', now() + interval '1 hour')`,
      );
      expect(insertRejected).toBe(true);
    });
  });

  it("ACL: EXECUTE concedido a app_system y denegado a PUBLIC", async () => {
    // Mismo invariante que `app.create_place` y `app.lookup_place_by_domain`:
    // la función nunca es invocable por un rol no previsto. Idempotente
    // bajo CREATE OR REPLACE (las grants no se pierden al re-correr la
    // migration en una branch fresca).
    await inRlsTx(async (tx) => {
      const sig = "app.consume_sso_jti(text, timestamptz)";
      const [acl] = (await tx.seed(
        `SELECT has_function_privilege('app_system', $1, 'EXECUTE') AS sys,
                has_function_privilege('public',     $1, 'EXECUTE') AS pub`,
        [sig],
      )) as Array<{ sys: boolean; pub: boolean }>;
      expect(acl.sys).toBe(true);
      expect(acl.pub).toBe(false);
    });
  });

  it("contract: pg_proc registra RETURNS boolean + VOLATILE + SECURITY DEFINER (regression de signature)", async () => {
    // Si alguien cambia el shape de la función (e.g. RETURNS jsonb {...},
    // STABLE, SECURITY INVOKER) la migración se aplica pero rompe el
    // contract con el wrapper TS de S8. Este test detecta el drift al
    // toplevel del schema antes de que la integración falle silenciosa.
    await inRlsTx(async (tx) => {
      const [meta] = (await tx.seed(
        `SELECT
           pg_get_function_result(p.oid)                         AS return_type,
           p.provolatile                                         AS volatile_kind,
           p.prosecdef                                           AS security_definer
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'app'
           AND p.proname = 'consume_sso_jti'`,
      )) as Array<{
        return_type: string;
        volatile_kind: string;
        security_definer: boolean;
      }>;
      expect(meta.return_type).toBe("boolean");
      // 'v' = VOLATILE en pg_proc.provolatile (vs 's' STABLE, 'i' IMMUTABLE).
      expect(meta.volatile_kind).toBe("v");
      expect(meta.security_definer).toBe(true);
    });
  });
});
