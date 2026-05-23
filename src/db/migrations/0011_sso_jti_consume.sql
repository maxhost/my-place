-- Feature C — Custom Domain SSO V1 · S1 (ADR-0032 §"Decisión 1 · jti single-use",
-- 2026-05-23).
--
-- Anti-replay del ticket SSO: cada ticket JWT lleva un `jti` (random UUID) que
-- el handler `/api/auth/sso-redeem` debe "consumir" exactamente una vez. Si el
-- mismo `jti` se presenta dos veces (browser back, replay attack, double-click)
-- la función retorna `false` y el redeem responde con `?sso_error=replay`.
--
-- ## Por qué la combinación tabla + función DEFINER (defense-in-depth doble)
--
-- La tabla `app.sso_jti_used` está owned por `neondb_owner` (el rol de
-- migraciones, BYPASSRLS) y NO concedemos GRANT a `app_system` (el rol
-- runtime). Doble capa de defensa:
--   (a) **Privilege layer**: sin GRANT, cualquier SELECT/INSERT/UPDATE/
--       DELETE directo desde `app_system` lanza `permission denied for
--       table sso_jti_used` ANTES de evaluar RLS. Feedback inmediato +
--       fuerte.
--   (b) **RLS layer (redundante)**: la tabla tiene RLS ENABLE sin
--       policies. Aún si por bug futuro alguien agrega GRANT a
--       `app_system`, todas las queries matchean 0 rows (deny silencioso
--       en SELECT, 0 rows affected en INSERT).
-- La función DEFINER `app.consume_sso_jti` es el ÚNICO canal: corre como
-- `neondb_owner` (su owner) → tiene privilegios completos sobre la tabla
-- + BYPASSRLS por dueño. Encapsula la única operación legítima (INSERT
-- atómico con GC).
--
-- Pattern paralelo a 0009 (`lookup_place_by_domain` para `place_domain`),
-- con la diferencia de que `place_domain` SÍ tiene policy owner-only para
-- el path RLS (owners leen su propia config). `sso_jti_used` no tiene path
-- legítimo de acceso owner-only: la tabla es PURAMENTE internal anti-replay
-- state, no hay UI que la muestre, sólo la función la toca.
--
-- Acá el caller del redeem es ANÓNIMO (el visitor del custom domain
-- todavía no tiene sesión local — la está construyendo en este mismo
-- flow), por lo que no podemos depender de un claim `sub` para autorizar;
-- la función DEFINER es el único canal seguro.
--
-- ## Atomicidad anti-race
--
-- `INSERT ... ON CONFLICT (jti) DO NOTHING` + `GET DIAGNOSTICS row_count`:
-- Postgres serializa el conflicto sobre la PK incluso bajo concurrencia real
-- (Postgres docs: ON CONFLICT toma row lock + escala a uniqueness check). Dos
-- consumes paralelos del mismo `jti` → exactamente uno gana (`row_count = 1`),
-- el otro ve `row_count = 0`. UX subóptima (double-click → uno falla) pero
-- secure. Cubierto por test "replay → false".
--
-- ## GC oportunista (no cron V1)
--
-- Cada consume hace `DELETE FROM app.sso_jti_used WHERE expires_at < now()`
-- ANTES del INSERT. Garbage collection amortizado: la tabla nunca crece más
-- allá del throughput de consumes activos × ticket TTL (60s). Sin cron job:
-- la tabla se auto-limpia con el tráfico mismo. Trade-off: si el tráfico cae
-- a cero, las filas expiradas quedan hasta el próximo consume — irrelevante
-- (filas inactivas, sin costo de query). Pattern aceptado en ADR-0032.
--
-- ## Invariantes
--
-- 1. **search_path fijo** (`app, public, pg_temp`): anti-hijack obligatorio
--    en DEFINER. `app` primero para que refs sin schema a `sso_jti_used`
--    siempre resuelvan a `app.sso_jti_used`. Defense-in-depth: las refs en
--    el cuerpo usan FULL qualification (`app.sso_jti_used`) aunque el
--    search_path lo permita sin qualifier.
-- 2. **VOLATILE**: modifica state (INSERT + DELETE). NO se puede marcar
--    STABLE ni IMMUTABLE (regression silenciosa: el optimizer cachearía
--    resultados → replay invisible).
-- 3. **RETURNS boolean**: shape estable. El wrapper TS (S8) mapea a
--    `Promise<boolean>` directo. Cambiar a `RETURNS jsonb {...}` rompería
--    el contract sin migration → bump explícito requerido si V2.
-- 4. **GET DIAGNOSTICS row_count** post-INSERT: única vía portable de
--    distinguir "fila insertada" (= primera consume) de "fila ya existía"
--    (= replay) sin usar `RETURNING` (que con `ON CONFLICT DO NOTHING` no
--    retorna nada en caso de conflict).
-- 5. **EXECUTE concedido SÓLO a `app_system`** (REVOKE FROM PUBLIC +
--    GRANT TO app_system): rol PUBLIC nunca puede invocarla. `app_system`
--    es el rol runtime canónico (ADR-0011), el ÚNICO que conecta el
--    backend Vercel a Postgres.
-- 6. **Tabla sin GRANT a app_system + RLS ENABLE sin policies**: doble
--    capa de deny. SELECT/INSERT directos desde `app_system` (caller real
--    del runtime) crashean con `permission denied for table sso_jti_used`
--    (privilege layer); aún si por bug futuro se agrega GRANT, RLS sin
--    policies entrega 0 rows / 0 affected. Cubierto por test
--    "defense-in-depth: SELECT/INSERT directos → permission denied".
-- 7. **`jti TEXT PRIMARY KEY`**: shape acepta cualquier formato (UUID v4
--    canónico hoy, opaque random base64url en V2). La PK garantiza
--    uniqueness atómico. Index implícito vía PK → lookups O(log n).
-- 8. **`expires_at TIMESTAMPTZ NOT NULL`**: stored en UTC, parseado con
--    timezone (el ticket lleva `exp` como epoch seconds; el wrapper TS
--    convierte a `new Date(exp * 1000)` antes de pasar). Defense-in-depth:
--    aún si el caller pasa un exp futuro absurdo (e.g. year 9999), el GC
--    nunca borra antes de tiempo → la fila ocupa lugar pero el INSERT con
--    PK conflict sigue funcionando.
-- 9. **Index sobre `expires_at`**: GC oportunista hace `DELETE WHERE
--    expires_at < now()` en cada consume → sin index, esto es seq scan O(n).
--    Con index `sso_jti_used_expires_at_idx`, el DELETE usa range scan
--    O(log n + k). Crítico bajo throughput alto.
--
-- ## Reverse SQL (rollback puntual)
--
--   REVOKE EXECUTE ON FUNCTION app.consume_sso_jti(text, timestamptz) FROM "app_system";
--   DROP FUNCTION IF EXISTS app.consume_sso_jti(text, timestamptz);
--   DROP TABLE IF EXISTS app.sso_jti_used;
--
-- Sin caveats: el rollback es completo, no deja efectos residuales. La
-- migration 0011 nunca corrió en prod (Feature C aún en construcción) → si
-- se ejecuta el rollback antes del deploy, no hay impact.
CREATE TABLE IF NOT EXISTS app.sso_jti_used (
  jti          TEXT PRIMARY KEY,
  consumed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sso_jti_used_expires_at_idx ON app.sso_jti_used (expires_at);--> statement-breakpoint
ALTER TABLE app.sso_jti_used ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Sin policies: el único acceso es vía app.consume_sso_jti (DEFINER).
-- Verificado por test "RLS regression" en consume-sso-jti.test.ts.
CREATE OR REPLACE FUNCTION app.consume_sso_jti(p_jti text, p_exp timestamptz)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = app, public, pg_temp
AS $$
DECLARE
  v_inserted int;
BEGIN
  -- GC oportunista: cada consume limpia jtis ya expirados antes del INSERT.
  -- Amortizado: la tabla nunca crece más allá del throughput × TTL.
  DELETE FROM app.sso_jti_used WHERE expires_at < now();
  -- INSERT atómico: ON CONFLICT (PK) toma row lock → race-safe.
  INSERT INTO app.sso_jti_used (jti, expires_at) VALUES (p_jti, p_exp)
  ON CONFLICT (jti) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  -- v_inserted = 1 → primera consume (consumed exitoso).
  -- v_inserted = 0 → jti ya existía (replay detectado).
  RETURN v_inserted = 1;
END;
$$;--> statement-breakpoint
-- EXECUTE solo app_system (no PUBLIC): consume nunca invocable por rol no
-- previsto. Idempotente (drizzle re-aplica en cada branch nuevo).
REVOKE EXECUTE ON FUNCTION app.consume_sso_jti(text, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.consume_sso_jti(text, timestamptz) TO "app_system";
