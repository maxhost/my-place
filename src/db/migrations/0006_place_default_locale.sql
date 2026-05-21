-- ADR-0022 + feature `settings` S2a.1 (2026-05-21): `place.default_locale` —
-- idioma del chrome del place, editable por owner. 6 locales operativos
-- (ADR-0024). Migración idempotente con DO BLOCK + IF NOT EXISTS para que
-- re-correr el `db:migrate` no rompa (ADR-0017 §Cierre del Watch: `pnpm
-- db:migrate` corre en cada deploy production; drizzle ya skipea entries
-- aplicadas en `drizzle.__drizzle_migrations`, pero la idempotencia interna
-- es defensa adicional contra drift entre branches).
--
-- DEFAULT 'es' aplica el valor a los rows existentes en el ALTER. Cero
-- backfill posterior necesario. Backward-compatible al 100%: el call viejo
-- de `app.create_place(text,text,text,jsonb,jsonb)` (5-arg, S3 de
-- place-creation) sigue funcionando porque la columna toma el DEFAULT
-- cuando el INSERT no la nombra (overload 6-arg llega en migration 0007).
--
-- CHECK constraint = defense-in-depth: el zod del wizard ya valida el enum
-- cerrado, pero la DB asegura el invariante aún si un caller futuro saltea
-- la app layer (ADR-0010 patrón).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'place' AND column_name = 'default_locale'
  ) THEN
    ALTER TABLE "place" ADD COLUMN "default_locale" text DEFAULT 'es' NOT NULL;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'place' AND constraint_name = 'place_default_locale_check'
  ) THEN
    ALTER TABLE "place" ADD CONSTRAINT "place_default_locale_check"
      CHECK ("place"."default_locale" IN ('es', 'en', 'fr', 'pt', 'de', 'ca'));
  END IF;
END $$;
