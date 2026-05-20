-- ADR-0021: patrón canónico para member-read — extender `_sel` con
-- `OR exists(membership activa)`. Cierra el TBD de ADR-0010 §1 ("el acceso
-- de miembros se agrega por-feature, encima, después"). Habilita la spec
-- del Hub (`docs/features/inbox/`, V1): el usuario ve los places donde es
-- owner O miembro activo. INSERT/UPDATE/DELETE siguen owner-only (los
-- miembros sólo ganan SELECT; mutaciones de miembros entran por funciones
-- SECURITY DEFINER específicas cuando esas features se construyan).

-- 1. place_sel: owner OR miembro activo (left_at IS NULL).
DROP POLICY IF EXISTS "place_sel" ON "place";--> statement-breakpoint
CREATE POLICY "place_sel" ON "place" AS PERMISSIVE FOR SELECT TO "app_system" USING (
  EXISTS (SELECT 1 FROM place_ownership po
          JOIN app_user au ON au.id = po.user_id
          WHERE po.place_id = "place"."id"
            AND au.auth_user_id = (select app.current_user_id()))
  OR
  EXISTS (SELECT 1 FROM membership m
          JOIN app_user au ON au.id = m.user_id
          WHERE m.place_id = "place"."id"
            AND m.left_at IS NULL
            AND au.auth_user_id = (select app.current_user_id()))
);--> statement-breakpoint

-- 2. membership_sel: owner del place OR self (mi propia row). El predicado de
-- member-read en membership es **self** (no "miembro del place") — un miembro
-- ve sus propias rows, no las de otros miembros del mismo place (esas las ve
-- sólo el owner, mismo predicado que hoy).
DROP POLICY IF EXISTS "membership_sel" ON "membership";--> statement-breakpoint
CREATE POLICY "membership_sel" ON "membership" AS PERMISSIVE FOR SELECT TO "app_system" USING (
  EXISTS (SELECT 1 FROM place_ownership po
          JOIN app_user au ON au.id = po.user_id
          WHERE po.place_id = "membership"."place_id"
            AND au.auth_user_id = (select app.current_user_id()))
  OR
  EXISTS (SELECT 1 FROM app_user au
          WHERE au.id = "membership"."user_id"
            AND au.auth_user_id = (select app.current_user_id()))
);--> statement-breakpoint

-- 3. Índice para el filtro principal del nuevo EXISTS de place_sel + queries
-- del hub (e.g. `app.get_inbox_payload()` en sesión 2). Cubre el predicado
-- (user_id, left_at) y permite el JOIN a place por place_id sin scan extra.
CREATE INDEX IF NOT EXISTS "idx_membership_user_active"
  ON "membership" ("user_id", "left_at", "place_id");
