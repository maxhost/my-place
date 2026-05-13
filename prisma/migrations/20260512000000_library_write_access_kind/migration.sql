-- S1a — Library write access kind (additive single migration).
--
-- ADR: docs/decisions/2026-05-12-library-permissions-model.md
-- Plan: docs/plans/2026-05-12-library-permissions-redesign.md
--
-- Cambios (additive — NO toca legacy `contributionPolicy` ni
-- `LibraryCategoryContributor` ni `GroupCategoryScope`; eso vive en S1b):
--
-- 1. Enum `WriteAccessKind` (OWNER_ONLY, GROUPS, TIERS, USERS).
-- 2. Columna `LibraryCategory.writeAccessKind` con default OWNER_ONLY.
-- 3. Tablas `LibraryCategoryGroupWriteScope`, `LibraryCategoryTierWriteScope`,
--    `LibraryCategoryUserWriteScope` (PK compuesto, FK ON DELETE CASCADE).
--
-- TODO RLS futura: las nuevas tablas se crean SIN policies (consistente
-- con las read scope tables creadas en 20260504020000). La fase RLS
-- general posterior cubrirá library + courses + access en una sola
-- migration. La RLS de `LibraryItem` sigue usando `contributionPolicy`
-- en S1a (se migra a `writeAccessKind` en S1b).

-- ────────────────────────────────────────────────────────────────────────
-- Step 1: enum nuevo
-- ────────────────────────────────────────────────────────────────────────

CREATE TYPE "WriteAccessKind" AS ENUM ('OWNER_ONLY', 'GROUPS', 'TIERS', 'USERS');

-- ────────────────────────────────────────────────────────────────────────
-- Step 2: columna nueva en LibraryCategory
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE "LibraryCategory"
  ADD COLUMN "writeAccessKind" "WriteAccessKind" NOT NULL DEFAULT 'OWNER_ONLY';

-- ────────────────────────────────────────────────────────────────────────
-- Step 3: tabla LibraryCategoryGroupWriteScope
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE "LibraryCategoryGroupWriteScope" (
  "categoryId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,

  CONSTRAINT "LibraryCategoryGroupWriteScope_pkey" PRIMARY KEY ("categoryId", "groupId")
);

CREATE INDEX "LibraryCategoryGroupWriteScope_groupId_idx" ON "LibraryCategoryGroupWriteScope"("groupId");

ALTER TABLE "LibraryCategoryGroupWriteScope"
  ADD CONSTRAINT "LibraryCategoryGroupWriteScope_categoryId_fkey"
    FOREIGN KEY ("categoryId")
    REFERENCES "LibraryCategory"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

ALTER TABLE "LibraryCategoryGroupWriteScope"
  ADD CONSTRAINT "LibraryCategoryGroupWriteScope_groupId_fkey"
    FOREIGN KEY ("groupId")
    REFERENCES "PermissionGroup"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────────
-- Step 4: tabla LibraryCategoryTierWriteScope
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE "LibraryCategoryTierWriteScope" (
  "categoryId" TEXT NOT NULL,
  "tierId" TEXT NOT NULL,

  CONSTRAINT "LibraryCategoryTierWriteScope_pkey" PRIMARY KEY ("categoryId", "tierId")
);

CREATE INDEX "LibraryCategoryTierWriteScope_tierId_idx" ON "LibraryCategoryTierWriteScope"("tierId");

ALTER TABLE "LibraryCategoryTierWriteScope"
  ADD CONSTRAINT "LibraryCategoryTierWriteScope_categoryId_fkey"
    FOREIGN KEY ("categoryId")
    REFERENCES "LibraryCategory"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

ALTER TABLE "LibraryCategoryTierWriteScope"
  ADD CONSTRAINT "LibraryCategoryTierWriteScope_tierId_fkey"
    FOREIGN KEY ("tierId")
    REFERENCES "Tier"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────────
-- Step 5: tabla LibraryCategoryUserWriteScope
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE "LibraryCategoryUserWriteScope" (
  "categoryId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,

  CONSTRAINT "LibraryCategoryUserWriteScope_pkey" PRIMARY KEY ("categoryId", "userId")
);

CREATE INDEX "LibraryCategoryUserWriteScope_userId_idx" ON "LibraryCategoryUserWriteScope"("userId");

ALTER TABLE "LibraryCategoryUserWriteScope"
  ADD CONSTRAINT "LibraryCategoryUserWriteScope_categoryId_fkey"
    FOREIGN KEY ("categoryId")
    REFERENCES "LibraryCategory"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

ALTER TABLE "LibraryCategoryUserWriteScope"
  ADD CONSTRAINT "LibraryCategoryUserWriteScope_userId_fkey"
    FOREIGN KEY ("userId")
    REFERENCES "User"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
