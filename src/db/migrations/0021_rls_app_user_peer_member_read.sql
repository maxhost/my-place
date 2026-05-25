-- Feature E · S6 (ADR-0038, 2026-05-25) — extender el patrón canónico
-- ADR-0021 al 3er sujeto del trio `place`/`membership`/`app_user`.
--
-- ## Contexto
--
-- ADR-0021 extendió `place_sel` y `membership_sel` con "owner OR
-- member-self" pero NO tocó `app_user`. La policy `au_self` queda
-- self-only puro (`FOR ALL` con `current_user_id() = authUserId`) →
-- imposible JOIN cross-user a `app_user` desde queries de feature.
--
-- Feature E S6 introdujo los primeros queries directos del proyecto con
-- esa necesidad (`loadMembers` y `loadPendingInvitations`): leer
-- `display_name`/`handle`/`avatar_url` de otros miembros / otros
-- inviters del mismo place. Sin esta extensión, los queries devolvían
-- 1 fila en vez de N.
--
-- ## Decisión
--
-- AGREGAR (no reemplazar) una segunda policy SELECT-only sobre
-- `app_user`: `au_peer_member_read`. Postgres OR-ea automáticamente
-- policies múltiples para la misma operación. INSERT/UPDATE/DELETE
-- siguen owner-only (la policy FOR SELECT no los afecta).
--
-- ## Anti-recursión: helper SECURITY DEFINER
--
-- El predicado natural (EXISTS con 3-table JOIN incluyendo `app_user`)
-- causa `infinite recursion detected in policy for relation "app_user"`
-- porque el JOIN interno re-lee app_user → re-trigger de la propia
-- policy → loop. Mismo gap conceptual que ADR-0035 §4 resolvió para
-- `place_ownership` con `app.current_user_owns_place(text)` SECURITY
-- DEFINER.
--
-- Patrón canónico aplicado aquí: extraer el EXISTS a una función
-- `app.is_peer_member(p_target_user_id text)` SECURITY DEFINER. El
-- DEFINER corre como `neondb_owner` (BYPASSRLS por construcción), lee
-- `membership` y `app_user` sin disparar las RLS de esas tablas →
-- bypassa el loop. Retorna boolean puro (cero leak de filas concretas
-- al caller; el output es 0 bits de información estructural más allá
-- del propio "sí, podés leer" que la policy ya implica).
--
-- ## Reglas de lectura post-migración
--
--   1. Caller lee su propia fila — `au_self`.
--   2. Caller lee fila de otro user X si comparten membership activa en
--      algún place — `au_peer_member_read` vía `app.is_peer_member`.
--   3. Caller NO lee fila de user X sin membership compartida activa.
--   4. Caller sin membership en ningún place → degenera a sólo su fila.
--   5. Owner del place P lee filas de todos los miembros activos de P
--      (por invariante ADR-0035 §2: owners son siempre miembros).
--   6. INSERT/UPDATE/DELETE siguen self-only (esta policy es FOR SELECT).
--
-- ## Reverse SQL inline
--
--   DROP POLICY IF EXISTS "au_peer_member_read" ON "app_user";
--   REVOKE EXECUTE ON FUNCTION app.is_peer_member(text) FROM "app_system";
--   DROP FUNCTION IF EXISTS app.is_peer_member(text);
--
-- ## Performance
--
-- El helper se invoca por CADA fila considerada en la SELECT (Postgres
-- evalúa la USING por fila). Cobertura de índices verificable con
-- EXPLAIN ANALYZE:
--   - `idx_membership_user_active(user_id, left_at, place_id)` ya existe
--     (migration 0004) — cubre ambos JOINs internos del DEFINER.
--   - Si surge regresión measurable, evaluar materializar el set de
--     places-del-caller en una CTE/WITH del query consumer (futuro).

-- 1. Helper SECURITY DEFINER + STABLE: bypassa RLS de la propia app_user
--    para resolver el predicado sin recursión. LANGUAGE sql + STABLE para
--    que el optimizer pueda planificar inline en el predicado de la policy.
CREATE OR REPLACE FUNCTION app.is_peer_member(p_target_user_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM membership my_m
      JOIN app_user my_au ON my_au.id = my_m.user_id
      JOIN membership other_m ON other_m.user_id = p_target_user_id
                             AND other_m.place_id = my_m.place_id
     WHERE my_au.auth_user_id = (select app.current_user_id())
       AND my_m.left_at IS NULL
       AND other_m.left_at IS NULL
  );
$$;--> statement-breakpoint

-- 2. ACL del helper: EXECUTE sólo a `app_system` (rol runtime), denegado a
--    PUBLIC. Idempotente bajo CREATE OR REPLACE (grants preservados entre
--    aplicaciones).
REVOKE EXECUTE ON FUNCTION app.is_peer_member(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.is_peer_member(text) TO "app_system";--> statement-breakpoint

-- 3. Policy SELECT-only sobre app_user, agregada (no reemplaza au_self).
--    Postgres OR-ea ambas en SELECT (self via au_self + peers via esta);
--    INSERT/UPDATE/DELETE siguen self-only porque esta policy es FOR SELECT.
CREATE POLICY "au_peer_member_read" ON "app_user" AS PERMISSIVE FOR SELECT TO "app_system" USING (
  app.is_peer_member("app_user"."id")
);
