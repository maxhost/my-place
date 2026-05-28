import * as Sentry from "@sentry/nextjs";

// Sentry init para runtime Edge. Loaded por `src/instrumentation.ts` cuando
// `process.env.NEXT_RUNTIME === "edge"`. Aplica al proxy (`src/proxy.ts`)
// que corre on-edge por defecto en Next 16 multi-tenant routing.
//
// ADR-0047 §"Implementación V1". Mismo shape que server config — el SDK
// distingue runtimes internamente.

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
  enabled: process.env.SENTRY_DSN !== undefined && process.env.SENTRY_DSN !== "",
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  debug: false,
  ignoreErrors: ["NEXT_REDIRECT", "NEXT_NOT_FOUND"],
});
