import * as Sentry from "@sentry/nextjs";

// Sentry init para runtime Edge. Loaded por `src/instrumentation.ts` cuando
// `process.env.NEXT_RUNTIME === "edge"`. Aplica al proxy (`src/proxy.ts`)
// que corre on-edge por defecto en Next 16 multi-tenant routing.
//
// ADR-0047 §"Implementación V1". Mismo shape que server config — el SDK
// distingue runtimes internamente.

// Mismo fallback chain que sentry.server.config.ts — ver allí el rationale
// completo. La integración Vercel × Sentry sincroniza `NEXT_PUBLIC_SENTRY_DSN`;
// `SENTRY_DSN` queda como override opcional.
const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  tracesSampleRate: 0,
  enabled: dsn !== undefined && dsn !== "",
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  debug: false,
  ignoreErrors: ["NEXT_REDIRECT", "NEXT_NOT_FOUND"],
});
