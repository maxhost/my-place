import * as Sentry from "@sentry/nextjs";

// Sentry init para client-side (browser). Next 16 carga este archivo
// automáticamente vía la convención `src/instrumentation-client.ts` y lo
// inyecta antes de cualquier código de la app. Reemplaza al patrón viejo
// `sentry.client.config.ts` que también funciona pero está deprecado en
// Next 16+.
//
// ADR-0047 §"Implementación V1".
//
// El DSN es público (bundleado en JS browser) — Sentry diseñó el DSN como
// rate-limited-by-default + project-scoped, NO es secret (similar a una
// public API key). Lo expone vía `NEXT_PUBLIC_SENTRY_DSN`.

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Tracing deshabilitado V1 — ver sentry.server.config.ts. Si se activa,
  // sampleRate idéntico en server y client para no skewar metrics.
  tracesSampleRate: 0,

  enabled:
    process.env.NEXT_PUBLIC_SENTRY_DSN !== undefined &&
    process.env.NEXT_PUBLIC_SENTRY_DSN !== "",

  environment:
    process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "development",

  debug: false,

  // Replay deshabilitado V1 — feature pesa ~50KB extra en JS bundle y
  // consume quota agresivamente. Reactivar V2+ si emerge need de debug
  // visual de bugs UI específicos.
  replaysOnErrorSampleRate: 0,
  replaysSessionSampleRate: 0,

  ignoreErrors: [
    // Errores comunes del browser que no son actionables.
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    // Browser extension noise.
    "Non-Error promise rejection captured",
  ],
});

// Hook para router navigation transitions — Sentry SDK Next.js lo provee y
// lo expone aquí para que `next/router` events generen breadcrumbs.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
