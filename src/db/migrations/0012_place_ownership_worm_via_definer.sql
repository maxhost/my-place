-- Feature D · S1 (ADR-0035 §3 + §4, 2026-05-24) — Hardening estructural del
-- modelo `place_ownership` + multi-owner explícito desde V1 + founder slot
-- inmutable. Cierra 3 asimetrías auditadas el 2026-05-23 (baseline `aaf238b`):
--
--   1. Policies SELF, no OWNER-OF-PLACE → owners no pueden ver/modificar
--      filas de OTROS owners del mismo place (expulsión cross-owner
--      estructuralmente imposible con la policy actual).
--   2. `po_upd` sin WITH CHECK → UPDATE owner-A puede orfanizar la propia
--      fila (cambiar user_id) sin que la policy rechace el post-image.
--   3. Cero enforcement DB del invariante "mínimo 1 owner por place activo"
--      (documentado en data-model.md:199 sin gate en el motor).
--
-- Solución canónica WORM-via-DEFINER (Write-Once-Read-Many vía SECURITY
-- DEFINER), patrón ya canónico del proyecto: `app.create_place` (ADR-0012 §3),
-- `app.consume_sso_jti` (ADR-0032 §6).
--
-- ## Cambios estructurales
--
-- 1. `place.founder_user_id text NOT NULL` (post back-fill). Referencia
--    lógica a `app_user.id` sin FK hard (mismo criterio que
--    `app_user.auth_user_id → neon_auth.user.id`, ADR-0006). Back-fill
--    determinístico: `MIN(granted_at).user_id` per place (criterio aligned
--    al invariante histórico "creador = primer owner"). Idempotente: re-run
--    no cambia datos existentes — cubierto por test T1.
--
-- 2. Helper `app.current_user_owns_place(text)` SECURITY DEFINER + STABLE.
--    Anti-recursión: el sub-SELECT a `place_ownership` desde una policy
--    sobre la propia tabla daría `infinite recursion` (Postgres aplica RLS
--    al sub-SELECT). El DEFINER bypassa la propia RLS por construcción
--    (corre como `neondb_owner`, BYPASSRLS), devuelve booleano puro (cero
--    leak de filas concretas al caller). Precedente: `app.lookup_place_by_domain`
--    para `place_domain` (ADR-0031 §5, migration 0009).
--
-- 3. Refactor RLS `place_ownership`:
--    - DROP de las 3 policies SELF: `po_sel`/`po_upd`/`po_del` (definidas en
--      0001:46-48 — el predicado `EXISTS app_user WHERE user_id = X` se
--      reemplaza por `app.current_user_owns_place(place_id)`).
--    - CREATE única `po_sel` FOR SELECT vía el helper → owners ven TODAS
--      las filas de ownership del place (necesario para UI futuro
--      "miembros con permiso de gestión" + para que `revoke_ownership`
--      lea la lista de owners actuales sin DEFINER adicional).
--    - INSERT/UPDATE/DELETE: SIN POLICY (denegadas por construcción) +
--      REVOKE explícito a `app_system` (defense-in-depth — mismo patrón
--      `place`/`membership` de 0001:54). Toda mutación pasa exclusivamente
--      por las 4 funciones DEFINER (`create_place` S5 set founder + las 3
--      restantes S2/S3/S4: elevate, revoke, transfer).
--
-- ## Por qué WORM-via-DEFINER vs alternativas (ADR-0035 §Alternativas rechazadas)
--
-- - App-only checks: bypaseables por admin scripts, migrations, jobs.
-- - BEFORE DELETE trigger: se evaluaría TAMBIÉN durante operaciones admin/
--   migration/restore, complicando backup-restore y seeding (falsos
--   positivos sin escape hatch).
-- - WORM-via-DEFINER: mueve la regla al borde correcto — la única superficie
--   de mutación = las funciones; admin con role `neondb_owner` puede
--   bypassear sin que los invariantes interfieran. Pattern ya canónico.
--
-- ## Reverse SQL (rollback puntual)
--
-- Idempotente; aplicable si la migration corrió en una branch test y se
-- requiere volver al estado pre-S1. No automatizable por drizzle-kit (no
-- soporta `down`). Manual:
--
--   REVOKE EXECUTE ON FUNCTION app.current_user_owns_place(text) FROM "app_system";
--   DROP FUNCTION IF EXISTS app.current_user_owns_place(text);
--   DROP POLICY IF EXISTS "po_sel" ON "public"."place_ownership";
--   CREATE POLICY "po_sel" ON "place_ownership" AS PERMISSIVE FOR SELECT TO "app_system"
--     USING (EXISTS (SELECT 1 FROM app_user au WHERE au.id = "place_ownership"."user_id"
--                      AND au.auth_user_id = (select app.current_user_id())));
--   CREATE POLICY "po_upd" ON "place_ownership" AS PERMISSIVE FOR UPDATE TO "app_system"
--     USING (EXISTS (SELECT 1 FROM app_user au WHERE au.id = "place_ownership"."user_id"
--                      AND au.auth_user_id = (select app.current_user_id())));
--   CREATE POLICY "po_del" ON "place_ownership" AS PERMISSIVE FOR DELETE TO "app_system"
--     USING (EXISTS (SELECT 1 FROM app_user au WHERE au.id = "place_ownership"."user_id"
--                      AND au.auth_user_id = (select app.current_user_id())));
--   GRANT UPDATE, DELETE ON TABLE "place_ownership" TO "app_system";
--   ALTER TABLE "place" DROP COLUMN "founder_user_id";

-- Paso 1 — Añadir columna nullable para permitir back-fill antes del NOT NULL.
ALTER TABLE "place" ADD COLUMN "founder_user_id" text;--> statement-breakpoint

-- Paso 2 — Back-fill determinístico (`MIN(granted_at).user_id` per place).
-- Criterio aligned al invariante histórico "creador = primer owner". Re-run
-- es no-op (cubierto por test T1 "back-fill ... idempotente").
UPDATE "place" p SET founder_user_id = (
  SELECT po.user_id FROM place_ownership po
  WHERE po.place_id = p.id
  ORDER BY po.granted_at ASC LIMIT 1
);--> statement-breakpoint

-- Paso 3 — Cerrar el invariante: post back-fill, todo place activo tiene
-- founder. Defensa contra paths futuros que creen places sin pasar por
-- `app.create_place` (refactor S5 que setea la columna en el INSERT).
ALTER TABLE "place" ALTER COLUMN "founder_user_id" SET NOT NULL;--> statement-breakpoint

-- Paso 4 — Helper SECURITY DEFINER anti-recursión. El sub-SELECT a
-- `place_ownership` desde una policy sobre la propia tabla daría
-- `infinite recursion`; el DEFINER bypassa la propia RLS por construcción.
-- LANGUAGE sql + STABLE: el optimizer puede planificar el helper inline
-- en predicados de policy; no muta state.
CREATE OR REPLACE FUNCTION app.current_user_owns_place(p_place_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM place_ownership po
    JOIN app_user au ON au.id = po.user_id
    WHERE po.place_id = p_place_id
      AND au.auth_user_id = (select app.current_user_id())
  );
$$;--> statement-breakpoint

-- Paso 5 — ACL del helper: EXECUTE sólo a `app_system` (rol runtime), denegado
-- a PUBLIC. Idempotente bajo CREATE OR REPLACE (grants preservados).
REVOKE EXECUTE ON FUNCTION app.current_user_owns_place(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_user_owns_place(text) TO "app_system";--> statement-breakpoint

-- Paso 6 — DROP de las 3 policies SELF previas. `IF EXISTS` por defensa
-- contra branches que no hayan recibido 0001 (siempre la tienen, pero el
-- guard es no-op si la policy ya está).
DROP POLICY IF EXISTS "po_sel" ON "public"."place_ownership";--> statement-breakpoint
DROP POLICY IF EXISTS "po_upd" ON "public"."place_ownership";--> statement-breakpoint
DROP POLICY IF EXISTS "po_del" ON "public"."place_ownership";--> statement-breakpoint

-- Paso 7 — Nueva po_sel vía helper. Owners ven TODAS las filas del place
-- (necesario para `revoke_ownership` S3 y para UI futuro). Cualquier intento
-- de mutación (INSERT/UPDATE/DELETE) queda sin policy → denegado por RLS
-- (defense-in-depth con REVOKE de paso 8). Toda mutación pasa por las 4
-- funciones DEFINER.
CREATE POLICY "po_sel" ON "public"."place_ownership"
  AS PERMISSIVE FOR SELECT TO "app_system"
  USING (app.current_user_owns_place(place_id));--> statement-breakpoint

-- Paso 8 — REVOKE UPDATE, DELETE: defense-in-depth contra futuro GRANT
-- accidental. INSERT ya estaba revocado en 0001:54 (parte del WORM original
-- `place_ownership` + `place` + `membership`). Idempotente: revocar un grant
-- inexistente es no-op.
REVOKE UPDATE, DELETE ON TABLE "place_ownership" FROM "app_system";
