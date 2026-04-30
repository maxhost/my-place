-- Slice `library` (R.7.1): schema base de categorías + RLS.
-- Ver docs/features/library/spec.md § 10 (modelo de datos) + § 11 (permisos).
--
-- Decisiones de diseño encodeadas:
--   1. `slug` es único per-place (no global) — mismo patrón que Post.slug. La
--      app la deriva del título y la persiste inmutable (resolveUniqueSlug
--      reusable, igual que en discussions/events).
--   2. `position INT` para orden manual del admin (drag & drop en R.7.3).
--      Default = NULL hasta que el create action calcule `max(position) + 1`.
--      Reservamos NULL para "sin orden definido" → ordering en query coalescea
--      `position` con `createdAt` para fallback determinístico.
--   3. `contributionPolicy` enum:
--        ADMIN_ONLY   → solo admin/owner crea items (default seguro)
--        DESIGNATED   → admin + miembros listados en LibraryCategoryContributor
--        MEMBERS_OPEN → cualquier miembro activo del place
--      La RLS de LibraryItem (R.7.5) leerá esta columna + la tabla join para
--      decidir INSERT.
--   4. `archivedAt` para soft-delete. La RLS oculta archivadas a authenticated;
--      service_role las ve para erasure 365d / scripts admin.
--   5. `LibraryCategoryContributor` tiene PK compuesta (categoryId, userId) —
--      idempotente: invitar dos veces al mismo user no crea duplicados.
--   6. `invitedByUserId` se preserva (audit). FK ON DELETE NO ACTION → si el
--      inviter borra cuenta, la fila queda con FK rota; en práctica el cron
--      de erasure 365d también limpia estos rows como side effect del DELETE
--      del User. Resolvemos esto cuando R.7.4 se implemente; por ahora
--      bloquear hard-delete es el comportamiento defensivo.
--   7. CHECK constraints sobre title (1..60 chars) y emoji (1..8 chars: emoji
--      compuestos pueden tener varios code points). Defensa en profundidad
--      sobre invariants de domain (R.7.2).

-- ────────────────────────────────────────────────────────────────────────
-- Enum: política de contribución por categoría.
-- ────────────────────────────────────────────────────────────────────────

CREATE TYPE "ContributionPolicy" AS ENUM (
  'ADMIN_ONLY',
  'DESIGNATED',
  'MEMBERS_OPEN'
);

-- ────────────────────────────────────────────────────────────────────────
-- Table: LibraryCategory
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE "LibraryCategory" (
  "id"                 TEXT NOT NULL,
  "placeId"            TEXT NOT NULL,
  "slug"               TEXT NOT NULL,
  "emoji"              TEXT NOT NULL,
  "title"              VARCHAR(60) NOT NULL,
  "position"           INTEGER,
  "contributionPolicy" "ContributionPolicy" NOT NULL DEFAULT 'ADMIN_ONLY',
  "archivedAt"         TIMESTAMP(3),
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LibraryCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LibraryCategory_placeId_slug_key"
  ON "LibraryCategory"("placeId", "slug");

CREATE INDEX "LibraryCategory_placeId_archivedAt_idx"
  ON "LibraryCategory"("placeId", "archivedAt");

CREATE INDEX "LibraryCategory_placeId_position_idx"
  ON "LibraryCategory"("placeId", "position");

ALTER TABLE "LibraryCategory"
  ADD CONSTRAINT "LibraryCategory_placeId_fkey"
    FOREIGN KEY ("placeId") REFERENCES "Place"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LibraryCategory"
  ADD CONSTRAINT "LibraryCategory_title_length_chk"
    CHECK (char_length("title") BETWEEN 1 AND 60),
  ADD CONSTRAINT "LibraryCategory_emoji_length_chk"
    CHECK (char_length("emoji") BETWEEN 1 AND 8),
  ADD CONSTRAINT "LibraryCategory_slug_format_chk"
    CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") BETWEEN 1 AND 80);

-- ────────────────────────────────────────────────────────────────────────
-- Table: LibraryCategoryContributor (designated)
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE "LibraryCategoryContributor" (
  "categoryId"      TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "invitedByUserId" TEXT NOT NULL,
  "invitedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LibraryCategoryContributor_pkey" PRIMARY KEY ("categoryId", "userId")
);

CREATE INDEX "LibraryCategoryContributor_userId_idx"
  ON "LibraryCategoryContributor"("userId");

ALTER TABLE "LibraryCategoryContributor"
  ADD CONSTRAINT "LibraryCategoryContributor_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "LibraryCategory"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LibraryCategoryContributor_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LibraryCategoryContributor_invitedByUserId_fkey"
    FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

-- ========================================================================
-- Row Level Security
-- ========================================================================
--
-- Helpers `is_active_member` y `is_place_admin` ya definidos en
-- 20260422000100_discussions_rls. Service role (jobs erasure / scripts)
-- bypassea RLS por default Supabase.

-- ────────────────────────────────────────────────────────────────────────
-- LibraryCategory
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE "LibraryCategory" ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier miembro activo ve las categorías no archivadas.
-- Las archivadas siguen siendo legibles para admins (necesitan poder
-- restaurarlas / auditar). La app NO debe surface archivadas a member común
-- pero la regla SQL es defensa en profundidad: archivada visible solo si admin.
CREATE POLICY "LibraryCategory_select_member_or_admin" ON "LibraryCategory"
  FOR SELECT
  USING (
    public.is_active_member("placeId")
    AND (
      "archivedAt" IS NULL
      OR public.is_place_admin("placeId")
    )
  );

-- INSERT: solo admin/owner del place crea categorías.
CREATE POLICY "LibraryCategory_insert_admin" ON "LibraryCategory"
  FOR INSERT
  WITH CHECK (public.is_place_admin("placeId"));

-- UPDATE: solo admin/owner. La app valida qué columnas cambian (slug
-- inmutable, etc.) — RLS es filtro de acceso, no validación de transición.
CREATE POLICY "LibraryCategory_update_admin" ON "LibraryCategory"
  FOR UPDATE
  USING (public.is_place_admin("placeId"));

-- DELETE: bloqueado para authenticated. Soft-delete via archivedAt; hard
-- delete solo via service_role (cascada del Place archivado, etc.).

-- ────────────────────────────────────────────────────────────────────────
-- LibraryCategoryContributor
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE "LibraryCategoryContributor" ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier miembro activo del place de la categoría ve la lista
-- (transparencia: saber quién puede crear en cada categoría).
CREATE POLICY "LibraryCategoryContributor_select_member" ON "LibraryCategoryContributor"
  FOR SELECT
  USING (
    public.is_active_member(
      (SELECT c."placeId" FROM "LibraryCategory" c WHERE c."id" = "categoryId")
    )
  );

-- INSERT: solo admin/owner del place de la categoría puede invitar.
CREATE POLICY "LibraryCategoryContributor_insert_admin" ON "LibraryCategoryContributor"
  FOR INSERT
  WITH CHECK (
    public.is_place_admin(
      (SELECT c."placeId" FROM "LibraryCategory" c WHERE c."id" = "categoryId")
    )
    AND "invitedByUserId" = auth.uid()::text
  );

-- DELETE: solo admin/owner del place. (Desinvitar.)
CREATE POLICY "LibraryCategoryContributor_delete_admin" ON "LibraryCategoryContributor"
  FOR DELETE
  USING (
    public.is_place_admin(
      (SELECT c."placeId" FROM "LibraryCategory" c WHERE c."id" = "categoryId")
    )
  );

-- UPDATE: prohibido. Los rows son inmutables — para cambiar contributors se
-- DELETE + INSERT. invitedAt y invitedBy son señales históricas.
