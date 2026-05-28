import * as Sentry from "@sentry/nextjs";

// Sentry init para runtime Node.js (Server Components, Server Actions, route
// handlers running on Fluid Compute). Loaded por `src/instrumentation.ts`
// cuando `process.env.NEXT_RUNTIME === "nodejs"`.
//
// ADR-0047 §"Implementación V1" — convention Sentry SDK Next.js.

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Tracing — DESHABILITADO V1. Activar V1.3+ si aparece need de APM
  // (slow Server Actions, slow DB queries). Cero spans/min en free tier
  // mientras este flag esté en 0.
  tracesSampleRate: 0,

  // Captura errores en producción. En dev local Sentry init es no-op si no
  // hay DSN — los `log.*` siguen funcionando vía console.* (ADR-0047
  // §"Behavior por entorno").
  enabled: process.env.SENTRY_DSN !== undefined && process.env.SENTRY_DSN !== "",

  // Releases: el SDK las infiere del SHA del commit Vercel (`VERCEL_GIT_COMMIT_SHA`)
  // automáticamente cuando el integration Vercel ↔ Sentry está activo. NO
  // hardcodear release acá.

  // Environments — auto-detect de Vercel.
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,

  // Quiet en dev local incluso si alguien setea DSN — evita ruido.
  debug: false,

  // Filtros default + ignore de errores ruido. Expandir cuando emerja signal.
  ignoreErrors: [
    // NextRedirect / NextNotFound son control flow, no errores reales.
    "NEXT_REDIRECT",
    "NEXT_NOT_FOUND",
  ],
});
