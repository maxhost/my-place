-- Migration: C.L — Erasure 365d schema
--
-- Agrega:
-- 1. Columna `Membership.erasureAppliedAt` — idempotency guard del job.
-- 2. Index parcial sobre `(leftAt)` WHERE eligible — el job escanea
--    eficientemente sin tablescan.
-- 3. Tabla `ErasureAuditLog` — snapshots ANTES del UPDATE + metadata de
--    cada run. Permite rollback manual via SQL si se detecta bug o
--    ejecución prematura.
--
-- Ver `docs/decisions/2026-04-24-erasure-365d.md`.

ALTER TABLE "Membership" ADD COLUMN "erasureAppliedAt" TIMESTAMP(3);

-- Index parcial: acelera la query eligible del job. Solo indexa filas
-- candidatas (leftAt IS NOT NULL AND erasureAppliedAt IS NULL) —
-- prácticamente todas las membresías activas NO entran acá.
CREATE INDEX "Membership_erasure_eligible_idx"
  ON "Membership" ("leftAt")
  WHERE "erasureAppliedAt" IS NULL AND "leftAt" IS NOT NULL;

-- Audit trail del job. Por membership procesada: qué Posts/Comments
-- afectó, snapshots anteriores, timestamp, y si fue dryRun.
CREATE TABLE "ErasureAuditLog" (
  "id" TEXT PRIMARY KEY,
  "membershipId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "placeId" TEXT NOT NULL,
  "postIds" TEXT[] NOT NULL,
  "commentIds" TEXT[] NOT NULL,
  "snapshotsBefore" JSONB NOT NULL,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "dryRun" BOOLEAN NOT NULL DEFAULT false,
  "error" TEXT
);

CREATE INDEX "ErasureAuditLog_membershipId_idx"
  ON "ErasureAuditLog" ("membershipId");
CREATE INDEX "ErasureAuditLog_appliedAt_idx"
  ON "ErasureAuditLog" ("appliedAt");

-- RLS: la tabla es admin-only. Sin policies expuestas → deny-all para
-- role `authenticated`. service_role bypassea automáticamente (patrón
-- estándar de Supabase). Los callers legítimos son:
-- 1. `runErasure` (job) via Prisma con DATABASE_URL (bypassea RLS).
-- 2. Admin SQL directo en Supabase dashboard para rollback manual.
ALTER TABLE "ErasureAuditLog" ENABLE ROW LEVEL SECURITY;
