-- Drop & recreate columns con shape Lexical (post-migración a Lexical).
-- Pre-prod: data descartable, TRUNCATE permitido.
-- Plan: docs/plans/2026-05-06-tiptap-to-lexical-migration.md
-- ADR: docs/decisions/2026-05-06-tiptap-to-lexical.md
--
-- Notas:
--  - Las columnas siguen siendo `JSONB` / `JSONB?`. El tipo SQL no cambia,
--    cambia el shape JSON adentro (TipTap AST → Lexical AST en F.2).
--  - TRUNCATE ... CASCADE limpia tablas dependientes vía FK (PostRead,
--    Reaction, Flag, EventRSVP, LibraryItemCompletion, LibraryItem) cuando
--    derivan de Post/Comment/Event. Listamos explícitamente las que van
--    al wipe inicial para que el plan sea legible.
--  - `Flag` es polimórfica (targetType ∈ {POST, COMMENT}) — un único
--    TRUNCATE limpia ambos kinds.

BEGIN;

TRUNCATE TABLE
  "Comment",
  "Post",
  "Event",
  "LibraryItem",
  "PostRead",
  "Reaction",
  "Flag",
  "EventRSVP",
  "LibraryItemCompletion"
CASCADE;

ALTER TABLE "Post" DROP COLUMN "body";
ALTER TABLE "Post" ADD COLUMN "body" JSONB;

ALTER TABLE "Comment" DROP COLUMN "body";
ALTER TABLE "Comment" ADD COLUMN "body" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "Comment" DROP COLUMN "quotedSnapshot";
ALTER TABLE "Comment" ADD COLUMN "quotedSnapshot" JSONB;

ALTER TABLE "Event" DROP COLUMN "description";
ALTER TABLE "Event" ADD COLUMN "description" JSONB;

COMMIT;
