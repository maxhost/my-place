-- Slice `discussions`: políticas Row Level Security.
-- Ver docs/features/discussions/spec.md § 5 + docs/stack.md (RLS mandatoria).
--
-- Las 6 tablas del slice están detrás de RLS como defensa en profundidad. La app
-- layer ya aplica `assertPlaceOpenOrThrow` + validación de membership, pero RLS
-- garantiza aislamiento multi-tenant incluso si un bug o ejecución SQL directa
-- bypass intentara leer/mutar filas de otro place.
--
-- Supabase Auth: `auth.uid()` devuelve un UUID. Nuestra tabla `User.id` es TEXT
-- (cuid compatible con el UUID de auth cuando llega por `auth.users.id`). Casteamos
-- explícitamente a text en las comparaciones para evitar errores de tipo.
--
-- Service role (jobs: erasure 365d, cron de PlaceOpening, exportes) se conecta con
-- `SUPABASE_SERVICE_ROLE_KEY` y bypassea RLS por default de Supabase — no hace
-- falta policy extra.
--
-- NOTA: Las policies de UPDATE sobre Post/Comment permiten al autor o admin tocar
-- la fila, pero NO validan ventana 60s ni qué columnas cambian — eso lo enforcea
-- la action (invariante temporal que SQL no puede expresar). RLS es filtro de
-- acceso, no validación de transición.

-- Helper: membership activo (leftAt IS NULL).
CREATE OR REPLACE FUNCTION public.is_active_member(place_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "Membership" m
    WHERE m."placeId" = place_id
      AND m."userId" = auth.uid()::text
      AND m."leftAt" IS NULL
  );
$$;

-- Helper: admin del place (membership ADMIN activo O PlaceOwnership).
CREATE OR REPLACE FUNCTION public.is_place_admin(place_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Membership" m
    WHERE m."placeId" = place_id
      AND m."userId" = auth.uid()::text
      AND m."leftAt" IS NULL
      AND m."role" = 'ADMIN'
  ) OR EXISTS (
    SELECT 1 FROM "PlaceOwnership" o
    WHERE o."placeId" = place_id
      AND o."userId" = auth.uid()::text
  );
$$;

-- Los helpers se ejecutan con SECURITY INVOKER: respetan las policies del caller.
-- Pero al joinear contra Membership/PlaceOwnership desde una policy de otra tabla,
-- entramos en recursión si Membership también tuviera RLS basada en ella misma.
-- Membership no tiene RLS hoy (pendiente gap global) — revisar cuando se habilite.

-- Grant execute a roles estándar de Supabase. Service role ya tiene todo.
GRANT EXECUTE ON FUNCTION public.is_active_member(TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_place_admin(TEXT) TO authenticated, anon;

-- ========================================================================
-- Post
-- ========================================================================

ALTER TABLE "Post" ENABLE ROW LEVEL SECURITY;

-- Los ex-miembros (leftAt IS NOT NULL) NO pasan is_active_member → no ven nada.
-- Admins ven HIDDEN/DELETED; members ven solo VISIBLE.
CREATE POLICY "Post_select_active_member" ON "Post"
  FOR SELECT
  USING (
    public.is_active_member("placeId")
    AND (
      ("deletedAt" IS NULL AND "hiddenAt" IS NULL)
      OR public.is_place_admin("placeId")
    )
  );

CREATE POLICY "Post_insert_self_author" ON "Post"
  FOR INSERT
  WITH CHECK (
    public.is_active_member("placeId")
    AND "authorUserId" = auth.uid()::text
  );

-- UPDATE: autor puede tocar su fila (app enforza ventana 60s y qué columnas);
-- admin puede hide/delete (también enforced en app para garantizar no-reescribe).
CREATE POLICY "Post_update_author_or_admin" ON "Post"
  FOR UPDATE
  USING (
    public.is_active_member("placeId")
    AND (
      "authorUserId" = auth.uid()::text
      OR public.is_place_admin("placeId")
    )
  )
  WITH CHECK (
    public.is_active_member("placeId")
    AND (
      "authorUserId" = auth.uid()::text
      OR public.is_place_admin("placeId")
    )
  );

-- DELETE: prohibido (soft delete vía UPDATE). Service role bypassea si hace falta
-- hard delete administrativo.
-- (No policy creada → RLS niega por default en ENABLE ROW LEVEL SECURITY.)

-- ========================================================================
-- Comment
-- ========================================================================

ALTER TABLE "Comment" ENABLE ROW LEVEL SECURITY;

-- SELECT devuelve comments deleted también: el render client-side muestra placeholder
-- para el miembro y contenido completo para el admin. Simplifica el patrón de
-- "comment eliminado" sin perder la posición en el hilo.
CREATE POLICY "Comment_select_active_member" ON "Comment"
  FOR SELECT
  USING (public.is_active_member("placeId"));

CREATE POLICY "Comment_insert_self_author" ON "Comment"
  FOR INSERT
  WITH CHECK (
    public.is_active_member("placeId")
    AND "authorUserId" = auth.uid()::text
  );

CREATE POLICY "Comment_update_author_or_admin" ON "Comment"
  FOR UPDATE
  USING (
    public.is_active_member("placeId")
    AND (
      "authorUserId" = auth.uid()::text
      OR public.is_place_admin("placeId")
    )
  )
  WITH CHECK (
    public.is_active_member("placeId")
    AND (
      "authorUserId" = auth.uid()::text
      OR public.is_place_admin("placeId")
    )
  );

-- DELETE: prohibido para usuarios. Soft delete vía UPDATE de deletedAt.

-- ========================================================================
-- Reaction
-- ========================================================================

ALTER TABLE "Reaction" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reaction_select_active_member" ON "Reaction"
  FOR SELECT
  USING (public.is_active_member("placeId"));

CREATE POLICY "Reaction_insert_self" ON "Reaction"
  FOR INSERT
  WITH CHECK (
    public.is_active_member("placeId")
    AND "userId" = auth.uid()::text
  );

-- Hard delete OK: una reacción no es contenido editorial, retirarla es legítimo.
CREATE POLICY "Reaction_delete_self" ON "Reaction"
  FOR DELETE
  USING ("userId" = auth.uid()::text);

-- No UPDATE: las reacciones se crean y borran, no se editan (el emoji es parte
-- de la identidad del row, por UNIQUE constraint).

-- ========================================================================
-- PlaceOpening
-- ========================================================================

ALTER TABLE "PlaceOpening" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "PlaceOpening_select_active_member" ON "PlaceOpening"
  FOR SELECT
  USING (public.is_active_member("placeId"));

-- INSERT / UPDATE / DELETE: solo service role (lazy open/close desde backend).
-- No creamos policies → RLS niega.

-- ========================================================================
-- PostRead
-- ========================================================================

ALTER TABLE "PostRead" ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier miembro activo del mismo place (derivado via Post.placeId)
-- puede ver quién leyó un Post (render "leyeron esta apertura"). Además el propio
-- user siempre ve sus propias filas para el dot indicator.
CREATE POLICY "PostRead_select_place_or_self" ON "PostRead"
  FOR SELECT
  USING (
    "userId" = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM "Post" p
      WHERE p."id" = "PostRead"."postId"
        AND public.is_active_member(p."placeId")
    )
  );

-- INSERT: solo el propio user. Validación de que el PlaceOpening pertenece al
-- mismo place del Post corre en la action (JOIN no barato en check RLS).
CREATE POLICY "PostRead_insert_self" ON "PostRead"
  FOR INSERT
  WITH CHECK (
    "userId" = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM "Post" p
      WHERE p."id" = "PostRead"."postId"
        AND public.is_active_member(p."placeId")
    )
  );

-- UPDATE / DELETE: solo service role (erasure 365d).

-- ========================================================================
-- Flag
-- ========================================================================

ALTER TABLE "Flag" ENABLE ROW LEVEL SECURITY;

-- SELECT: admin ve toda la cola del place; reporter ve sus propios flags.
CREATE POLICY "Flag_select_admin_or_reporter" ON "Flag"
  FOR SELECT
  USING (
    public.is_place_admin("placeId")
    OR "reporterUserId" = auth.uid()::text
  );

CREATE POLICY "Flag_insert_self_reporter" ON "Flag"
  FOR INSERT
  WITH CHECK (
    public.is_active_member("placeId")
    AND "reporterUserId" = auth.uid()::text
  );

-- UPDATE: solo admin del place puede marcar review / cerrar.
CREATE POLICY "Flag_update_admin" ON "Flag"
  FOR UPDATE
  USING (public.is_place_admin("placeId"))
  WITH CHECK (public.is_place_admin("placeId"));

-- DELETE: prohibido.
