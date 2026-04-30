-- Slice `library` (R.7.5): tabla LibraryItem + RLS.
-- Ver docs/features/library/spec.md § 10 (modelo) + § 11 (permisos).
--
-- Decisiones de diseño encodeadas:
--   1. LibraryItem es 1:1 con Post: el item ES el thread documento. La FK
--      `postId UNIQUE` materializa esa biyección. ON DELETE CASCADE: si el
--      Post desaparece (place archivado, erasure física), el item se va con
--      él. Mismo patrón que Event.postId pero con cascada (Event usa
--      SetNull para preservar el evento sin thread; en biblioteca no tiene
--      sentido — un item sin Post es contenido vacío).
--   2. `placeId` denormalizado (también vive en Post.placeId). Razón: la
--      RLS filtra por `is_active_member("placeId")` en cada SELECT — sin
--      la columna habría que hacer JOIN al Post en cada fila, costoso. La
--      app garantiza que `LibraryItem.placeId === Post.placeId` (insert
--      atómico en createItemAction R.7.6).
--   3. `authorUserId` denormalizado (también vive en Post.authorUserId).
--      Mismo razonamiento que `placeId`: la policy de UPDATE necesita
--      "es el author?" y hacerlo via subquery a Post falla en el contexto
--      de WITH CHECK de Postgres (probado empíricamente — el evaluador
--      no resuelve EXISTS subquery contra Post correctamente al validar
--      la NEW row tras UPDATE). Patrón consistente con `Event.authorUserId`.
--      Erasure 365d nullifica ambas columnas coordinadamente.
--   4. `categoryId` ON DELETE Restrict: no permitimos DELETE físico de
--      categoría con items vivos (defensa en profundidad — la app solo
--      hace soft-delete via archivedAt).
--   5. `coverUrl` nullable: cover opcional, mobile no renderiza, reservado
--      para layout desktop futuro (decisión user 2026-04-30).
--   6. NO hay XOR check SQL entre eventId y libraryItemId — el schema
--      actual NO extiende Post con esas columnas (Event y LibraryItem
--      tienen back-pointer Prisma vía `postId UNIQUE` desde su lado). La
--      validación XOR vive en domain: createEventAction y createItemAction
--      chequean que el Post no esté ya asociado al otro tipo. Documentado
--      en spec § 10.2.

-- ────────────────────────────────────────────────────────────────────────
-- Table: LibraryItem
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE "LibraryItem" (
  "id"           TEXT NOT NULL,
  "placeId"      TEXT NOT NULL,
  "categoryId"   TEXT NOT NULL,
  "postId"       TEXT NOT NULL,
  "authorUserId" TEXT,
  "coverUrl"     TEXT,
  "archivedAt"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LibraryItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LibraryItem_postId_key" ON "LibraryItem"("postId");
CREATE INDEX "LibraryItem_placeId_archivedAt_idx" ON "LibraryItem"("placeId", "archivedAt");
CREATE INDEX "LibraryItem_categoryId_archivedAt_idx" ON "LibraryItem"("categoryId", "archivedAt");

ALTER TABLE "LibraryItem"
  ADD CONSTRAINT "LibraryItem_placeId_fkey"
    FOREIGN KEY ("placeId") REFERENCES "Place"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LibraryItem_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "LibraryCategory"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LibraryItem_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "Post"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LibraryItem_authorUserId_fkey"
    FOREIGN KEY ("authorUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ========================================================================
-- Row Level Security
-- ========================================================================
--
-- Helpers `is_active_member` y `is_place_admin` ya definidos en
-- 20260422000100_discussions_rls.

ALTER TABLE "LibraryItem" ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────────────────
-- SELECT
-- ────────────────────────────────────────────────────────────────────────
-- Cualquier miembro activo ve los items NO archivados. Admin ve todos
-- (para audit + restore). Author SIEMPRE ve sus propios items (incluso
-- archivados): si esto no fuera así, archivar el propio item haría que
-- la fila se vuelva invisible al author y Postgres bloquearía el UPDATE
-- como "blind write" (security feature de Postgres ≥13). El author que
-- archivó no ve sus archivadas en el listado público — la app filtra
-- por archivedAt en la query — pero RLS no se lo bloquea.
CREATE POLICY "LibraryItem_select_member_or_admin" ON "LibraryItem"
  FOR SELECT
  USING (
    public.is_active_member("placeId")
    AND (
      "archivedAt" IS NULL
      OR public.is_place_admin("placeId")
      OR "authorUserId" = auth.uid()::text
    )
  );

-- ────────────────────────────────────────────────────────────────────────
-- INSERT — replica matriz canCreateInCategory en SQL
-- ────────────────────────────────────────────────────────────────────────
-- Reglas:
--   - admin/owner del place: siempre
--   - policy=ADMIN_ONLY: solo admin
--   - policy=DESIGNATED: admin O userId en LibraryCategoryContributor
--   - policy=MEMBERS_OPEN: cualquier miembro activo
--
-- También exigimos `authorUserId = auth.uid()` para que un member no
-- pueda crear un item "en nombre" de otro.
CREATE POLICY "LibraryItem_insert_with_policy" ON "LibraryItem"
  FOR INSERT
  WITH CHECK (
    public.is_active_member("placeId")
    AND "authorUserId" = auth.uid()::text
    AND (
      public.is_place_admin("placeId")
      OR EXISTS (
        SELECT 1 FROM "LibraryCategory" c
        WHERE c."id" = "LibraryItem"."categoryId"
          AND c."placeId" = "LibraryItem"."placeId"
          AND c."archivedAt" IS NULL
          AND (
            c."contributionPolicy" = 'MEMBERS_OPEN'
            OR (
              c."contributionPolicy" = 'DESIGNATED'
              AND EXISTS (
                SELECT 1 FROM "LibraryCategoryContributor" cc
                WHERE cc."categoryId" = c."id"
                  AND cc."userId" = auth.uid()::text
              )
            )
          )
      )
    )
  );

-- ────────────────────────────────────────────────────────────────────────
-- UPDATE — admin del place o author directo (sin subquery)
-- ────────────────────────────────────────────────────────────────────────
CREATE POLICY "LibraryItem_update_admin_or_author" ON "LibraryItem"
  FOR UPDATE
  USING (
    public.is_active_member("placeId")
    AND (
      "authorUserId" = auth.uid()::text
      OR public.is_place_admin("placeId")
    )
  );

-- ────────────────────────────────────────────────────────────────────────
-- DELETE bloqueado (soft-delete via archivedAt)
-- ────────────────────────────────────────────────────────────────────────
-- Sin policy DELETE → default DENY para authenticated. Service role
-- bypassea para erasure física al archivar el place.
