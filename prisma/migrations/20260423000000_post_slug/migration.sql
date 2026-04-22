-- Post.slug: URL segment derivado del título, único por place.
-- Ver docs/features/discussions/spec.md §13 URL format.
-- DB de dev está vacía; producción aún no existe. Si hay filas, el DEFAULT ''
-- provisional permite crear la columna NOT NULL; el UNIQUE index luego fallaría
-- con slugs vacíos duplicados (intencional: obliga a backfill explícito).

ALTER TABLE "Post" ADD COLUMN "slug" VARCHAR(180) NOT NULL DEFAULT '';
ALTER TABLE "Post" ALTER COLUMN "slug" DROP DEFAULT;

CREATE UNIQUE INDEX "Post_placeId_slug_key" ON "Post" ("placeId", "slug");
