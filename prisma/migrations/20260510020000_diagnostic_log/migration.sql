-- Tabla de diagnóstico temporal para debugging del flow auth.
-- DEBE BORRARSE antes de prod (ver docs/pre-launch-checklist.md).
-- RLS DISABLED siguiendo el patrón del core (escribe via Prisma con connection
-- privilegiada, no via SDK Supabase). Lectura solo via service role / MCP.

CREATE TABLE "DiagnosticLog" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "traceId" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "userId" TEXT,
  "sessionState" TEXT,
  "cookieNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "event" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "userAgent" TEXT,
  "ipPrefix" TEXT
);

CREATE INDEX "DiagnosticLog_createdAt_idx" ON "DiagnosticLog" ("createdAt" DESC);
CREATE INDEX "DiagnosticLog_traceId_idx" ON "DiagnosticLog" ("traceId");
CREATE INDEX "DiagnosticLog_event_idx" ON "DiagnosticLog" ("event");
CREATE INDEX "DiagnosticLog_severity_idx" ON "DiagnosticLog" ("severity");
CREATE INDEX "DiagnosticLog_userId_idx" ON "DiagnosticLog" ("userId") WHERE "userId" IS NOT NULL;

COMMENT ON TABLE "DiagnosticLog" IS 'TEMPORAL: diagnóstico del flow auth (callbacks, logout, middleware, RLS). Borrar antes de prod junto con src/shared/lib/diag/.';
