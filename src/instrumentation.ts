// Next 16 instrumentation hook canónico. Dispatch por runtime al config
// correspondiente de Sentry (ADR-0047 §"Implementación V1"):
//
//   - `NEXT_RUNTIME === "nodejs"` → sentry.server.config.ts (RSC, Server
//     Actions, route handlers running on Fluid Compute).
//   - `NEXT_RUNTIME === "edge"` → sentry.edge.config.ts (proxy.ts).
//
// El hook se ejecuta una vez por cold start de cada runtime. Init de Sentry
// con DSN no presente es no-op (SDK default behavior).
//
// Sentry SDK Next.js wraps automáticamente:
//   - Server Action throws → Sentry.captureException.
//   - Route handler throws → idem.
//   - RSC render errors → idem.
//   - Middleware (proxy) errors en edge → idem.
//
// Manual `log.error(...)` (wrapper de `src/shared/lib/observability/log.ts`)
// llama a `Sentry.captureException` explícitamente — los wrappers automáticos
// y el manual coexisten sin double-counting (Sentry dedupea por fingerprint).

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Forward de errores capturados por React Server Components / Server Actions
// al SDK Sentry. Next 16 invoca este export en cada request error si está
// presente. Sin esto, los errores que React swallow-y-retorna como "Server
// Components render error" no llegan al tracker.
export { captureRequestError as onRequestError } from "@sentry/nextjs";
