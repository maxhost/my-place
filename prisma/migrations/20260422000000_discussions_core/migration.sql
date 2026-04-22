-- Slice `discussions` (C.B de Fase 5): schema core del foro.
-- Ver docs/features/discussions/spec.md § 4 (Entidades) y § 8 (Invariantes).
--
-- Decisiones de diseño encodeadas en esta migración:
--   1. `authorUserId` nullable + `authorSnapshot jsonb` → erasure 365d (data-model.md).
--      Al nulificar author, snapshot preserva displayName/avatar para render.
--   2. Polimórficos (Reaction.target, Flag.target): `targetType` enum + `targetId text`
--      sin FK dura — chequeo de consistencia en action layer + RLS por placeId.
--   3. Soft delete vía timestamps (hiddenAt, deletedAt) — nunca DELETE desde UI; RLS
--      prohíbe DELETE excepto service role. Hard delete solo por DBA vía SQL.
--   4. Optimistic locking vía `version int` en Post y Comment.
--   5. `Comment.placeId` denormalizado para RLS eficiente y cursor queries (no re-join).
--   6. Índices parciales (`WHERE deletedAt IS NULL`, `WHERE authorUserId IS NOT NULL`,
--      `WHERE endAt IS NULL`) — Prisma no los soporta declarativamente. Están acá.
--   7. CHECK constraints para invariantes que DEBEN fallar al nivel DB aunque el app
--      layer ya valide: título no-vacío, authorSnapshot estructurado, consistencia de
--      flag status, size cap del body jsonb (20 KB).
--   8. Ventana 60s de edit se enforcea en action — no hay CHECK temporal (la DB no
--      conoce `now()` al momento de validar vs `createdAt` cuando el row ya existe).
--
-- Las políticas RLS viven en la migración hermana 20260422000100_discussions_rls
-- para mantener este archivo como "schema puro". Aplicarlas juntas en el mismo deploy.

-- CreateEnum
CREATE TYPE "ContentTargetKind" AS ENUM ('POST', 'COMMENT');

-- CreateEnum
CREATE TYPE "ReactionEmoji" AS ENUM ('THUMBS_UP', 'HEART', 'LAUGH', 'PRAY', 'THINKING', 'CRY');

-- CreateEnum
CREATE TYPE "PlaceOpeningSource" AS ENUM ('SCHEDULED', 'ALWAYS_OPEN', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "FlagReason" AS ENUM ('SPAM', 'HARASSMENT', 'OFFTOPIC', 'MISINFO', 'OTHER');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('OPEN', 'REVIEWED_ACTIONED', 'REVIEWED_DISMISSED');

-- CreateTable Post
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorSnapshot" JSONB NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable Comment
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorSnapshot" JSONB NOT NULL,
    "body" JSONB NOT NULL,
    "quotedCommentId" TEXT,
    "quotedSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable Reaction
CREATE TABLE "Reaction" (
    "id" TEXT NOT NULL,
    "targetType" "ContentTargetKind" NOT NULL,
    "targetId" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" "ReactionEmoji" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable PlaceOpening
CREATE TABLE "PlaceOpening" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "source" "PlaceOpeningSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaceOpening_pkey" PRIMARY KEY ("id")
);

-- CreateTable PostRead
CREATE TABLE "PostRead" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "placeOpeningId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dwellMs" INTEGER NOT NULL,

    CONSTRAINT "PostRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable Flag
CREATE TABLE "Flag" (
    "id" TEXT NOT NULL,
    "targetType" "ContentTargetKind" NOT NULL,
    "targetId" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "reason" "FlagReason" NOT NULL,
    "reasonNote" VARCHAR(500),
    "status" "FlagStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewerAdminUserId" TEXT,
    "reviewNote" VARCHAR(500),

    CONSTRAINT "Flag_pkey" PRIMARY KEY ("id")
);

-- CHECK constraints (invariantes de dominio que DEBEN fallar en DB)

-- Post: título no-whitespace.
ALTER TABLE "Post"
  ADD CONSTRAINT "Post_title_not_blank" CHECK (btrim("title") <> '');

-- Post: authorSnapshot debe tener al menos la clave displayName (nunca `{}` vacío).
ALTER TABLE "Post"
  ADD CONSTRAINT "Post_authorSnapshot_has_displayName" CHECK ("authorSnapshot" ? 'displayName');

-- Post: body ≤ 20 KB serializado (size cap del TipTap AST).
ALTER TABLE "Post"
  ADD CONSTRAINT "Post_body_size_cap" CHECK ("body" IS NULL OR pg_column_size("body") <= 20480);

-- Comment: mismo invariante en authorSnapshot.
ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_authorSnapshot_has_displayName" CHECK ("authorSnapshot" ? 'displayName');

-- Comment: body size cap.
ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_body_size_cap" CHECK (pg_column_size("body") <= 20480);

-- Comment: si hay quotedCommentId debe haber quotedSnapshot (congelado al crear).
ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_quote_consistency"
  CHECK ("quotedCommentId" IS NULL OR "quotedSnapshot" IS NOT NULL);

-- Comment: cita no puede apuntar a sí misma.
ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_quote_not_self" CHECK ("quotedCommentId" IS NULL OR "quotedCommentId" <> "id");

-- PlaceOpening: si endAt no es null debe ser > startAt.
ALTER TABLE "PlaceOpening"
  ADD CONSTRAINT "PlaceOpening_endAt_after_startAt"
  CHECK ("endAt" IS NULL OR "endAt" > "startAt");

-- PostRead: dwell no-negativo.
ALTER TABLE "PostRead"
  ADD CONSTRAINT "PostRead_dwellMs_non_negative" CHECK ("dwellMs" >= 0);

-- Flag: status/reviewedAt consistency (cerrado ⇒ reviewedAt seteado).
ALTER TABLE "Flag"
  ADD CONSTRAINT "Flag_status_review_consistency"
  CHECK ("status" = 'OPEN' OR "reviewedAt" IS NOT NULL);

-- Flag: si reviewedAt está seteado, reviewerAdminUserId también.
ALTER TABLE "Flag"
  ADD CONSTRAINT "Flag_reviewer_consistency"
  CHECK ("reviewedAt" IS NULL OR "reviewerAdminUserId" IS NOT NULL);

-- Índices simples (no parciales)

-- Post
CREATE INDEX "Post_placeId_createdAt_idx" ON "Post"("placeId", "createdAt" DESC);

-- Comment
CREATE INDEX "Comment_postId_createdAt_idx" ON "Comment"("postId", "createdAt");
CREATE INDEX "Comment_placeId_idx" ON "Comment"("placeId");
CREATE INDEX "Comment_quotedCommentId_idx" ON "Comment"("quotedCommentId");

-- Reaction
CREATE INDEX "Reaction_targetType_targetId_idx" ON "Reaction"("targetType", "targetId");
CREATE INDEX "Reaction_placeId_idx" ON "Reaction"("placeId");
CREATE INDEX "Reaction_userId_idx" ON "Reaction"("userId");
CREATE UNIQUE INDEX "Reaction_target_user_emoji_key"
  ON "Reaction"("targetType", "targetId", "userId", "emoji");

-- PlaceOpening
CREATE INDEX "PlaceOpening_placeId_startAt_idx" ON "PlaceOpening"("placeId", "startAt" DESC);

-- PostRead
CREATE INDEX "PostRead_postId_placeOpeningId_idx" ON "PostRead"("postId", "placeOpeningId");
CREATE INDEX "PostRead_userId_postId_idx" ON "PostRead"("userId", "postId");
CREATE UNIQUE INDEX "PostRead_post_user_opening_key"
  ON "PostRead"("postId", "userId", "placeOpeningId");

-- Flag
CREATE INDEX "Flag_placeId_status_createdAt_idx"
  ON "Flag"("placeId", "status", "createdAt" DESC);
CREATE INDEX "Flag_reporterUserId_idx" ON "Flag"("reporterUserId");
CREATE INDEX "Flag_reviewerAdminUserId_idx" ON "Flag"("reviewerAdminUserId");
CREATE UNIQUE INDEX "Flag_target_reporter_key"
  ON "Flag"("targetType", "targetId", "reporterUserId");

-- Índices parciales (Prisma no los soporta declarativamente)

-- Post: lista foro ordenada por última actividad. Excluye soft-deleted.
CREATE INDEX "Post_placeId_lastActivityAt_active_idx"
  ON "Post"("placeId", "lastActivityAt" DESC)
  WHERE "deletedAt" IS NULL;

-- Post: perfil contextual del miembro + scan por erasure (365d).
CREATE INDEX "Post_authorUserId_active_idx"
  ON "Post"("authorUserId")
  WHERE "authorUserId" IS NOT NULL;

-- Comment: cursor keyset backward (createdAt DESC, id DESC). Excluye soft-deleted.
CREATE INDEX "Comment_postId_cursor_active_idx"
  ON "Comment"("postId", "createdAt" DESC, "id" DESC)
  WHERE "deletedAt" IS NULL;

-- Comment: perfil contextual + erasure.
CREATE INDEX "Comment_authorUserId_active_idx"
  ON "Comment"("authorUserId")
  WHERE "authorUserId" IS NOT NULL;

-- PlaceOpening: máximo 1 apertura activa simultánea por place.
-- Garantiza que findOrCreateCurrentOpening no pueda duplicar filas por race.
CREATE UNIQUE INDEX "PlaceOpening_active_unique"
  ON "PlaceOpening"("placeId")
  WHERE "endAt" IS NULL;

-- Foreign keys
-- ON DELETE RESTRICT por default para proteger erasure (el user solo se nulifica
-- vía UPDATE al expirar 365d; un DELETE accidental sobre User fallaría si hay posts
-- todavía vivos). authorUserId usa SET NULL porque ese es exactamente el efecto
-- deseado cuando el user se borra por administración.

ALTER TABLE "Post"
  ADD CONSTRAINT "Post_placeId_fkey"
    FOREIGN KEY ("placeId") REFERENCES "Place"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Post"
  ADD CONSTRAINT "Post_authorUserId_fkey"
    FOREIGN KEY ("authorUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "Post"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_placeId_fkey"
    FOREIGN KEY ("placeId") REFERENCES "Place"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_authorUserId_fkey"
    FOREIGN KEY ("authorUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_quotedCommentId_fkey"
    FOREIGN KEY ("quotedCommentId") REFERENCES "Comment"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Reaction"
  ADD CONSTRAINT "Reaction_placeId_fkey"
    FOREIGN KEY ("placeId") REFERENCES "Place"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Reaction"
  ADD CONSTRAINT "Reaction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlaceOpening"
  ADD CONSTRAINT "PlaceOpening_placeId_fkey"
    FOREIGN KEY ("placeId") REFERENCES "Place"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PostRead"
  ADD CONSTRAINT "PostRead_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "Post"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PostRead"
  ADD CONSTRAINT "PostRead_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PostRead"
  ADD CONSTRAINT "PostRead_placeOpeningId_fkey"
    FOREIGN KEY ("placeOpeningId") REFERENCES "PlaceOpening"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Flag"
  ADD CONSTRAINT "Flag_placeId_fkey"
    FOREIGN KEY ("placeId") REFERENCES "Place"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Flag"
  ADD CONSTRAINT "Flag_reporterUserId_fkey"
    FOREIGN KEY ("reporterUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Flag"
  ADD CONSTRAINT "Flag_reviewerAdminUserId_fkey"
    FOREIGN KEY ("reviewerAdminUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Trigger: validar que quotedCommentId pertenece al mismo postId que el comment que cita.
-- (CHECK con subquery no está permitido en Postgres; usamos trigger como defense-in-depth.)

CREATE OR REPLACE FUNCTION enforce_comment_quote_same_post()
RETURNS TRIGGER AS $$
DECLARE
  quoted_post TEXT;
BEGIN
  IF NEW."quotedCommentId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "postId" INTO quoted_post FROM "Comment" WHERE "id" = NEW."quotedCommentId";

  IF quoted_post IS NULL THEN
    -- Padre no existe. Snapshot sigue siendo la fuente de verdad; la action debe
    -- haber congelado ya `quotedSnapshot`. RLS permite; la FK on delete SET NULL
    -- cubre desaparición posterior.
    RETURN NEW;
  END IF;

  IF quoted_post <> NEW."postId" THEN
    RAISE EXCEPTION 'comment_quote_cross_post: cita cruza posts (% vs %)',
      NEW."postId", quoted_post
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER comment_quote_same_post_check
  BEFORE INSERT OR UPDATE OF "quotedCommentId" ON "Comment"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_comment_quote_same_post();
