import * as Sentry from "@sentry/nextjs";

// Wrapper canónico de observability (ADR-0047). API minimal: `log.info`,
// `log.warn`, `log.error`. Aísla los callsites de la API del SDK Sentry —
// future eject (OpenTelemetry / GlitchTip / etc.) toca SOLO este archivo, no
// los 26 callsites cliente.
//
// ## Mapping a Sentry
//
// - `log.info` → SOLO `console.info` (structured JSON). NO Sentry — info no
//   tiene caso de uso V1 (cero callsites informativos hoy) y consumiría
//   cuota del free tier sin retorno. Si V1.3+ aparece audit trail, evaluamos
//   `Sentry.addBreadcrumb` o ingest separado (Axiom via Log Drain).
// - `log.warn` → `console.warn` + `Sentry.captureMessage(level: "warning")`.
// - `log.error` → `console.error` + `Sentry.captureException(err, extras)`.
//
// ## Behavior por entorno
//
// Sin `SENTRY_DSN` el SDK Sentry init es no-op (su comportamiento default).
// Eso significa que en dev local sin Sentry provisionado, los callsites
// siguen funcionando vía `console.*` para developer feedback. En prod sin
// DSN, perdemos visibilidad pero NO crasheamos — Sentry NO es control de
// seguridad (a diferencia del rate-limit Phase 0.D que sí fail-loud-prod).
// Trade-off explícito en ADR-0047 §"Alternativas rechazadas" — δ.
//
// ## Defense-in-depth
//
// Las llamadas a Sentry van envueltas en try/catch. El SDK contract garantiza
// no-throw (queue-based, async), pero un blip de la lib NUNCA debe romper el
// caller. La fuente de verdad local (`console.*`) corre primero — si Sentry
// falla, los logs Vercel siguen capturando la línea.
//
// ## Schema del payload JSON
//
// ```
// {
//   "level": "info" | "warn" | "error",
//   "message": <string>,
//   "errMessage"?: <string>      // solo en error: err.message o String(err)
//   ...meta                      // shallow spread del LogMeta
// }
// ```
//
// El segundo arg de `console.error` es el `err` raw — preserva stack trace
// para inspección humana en Vercel logs (Sentry también lo recibe pero por
// canal separado).

export type LogMeta = Record<string, unknown>;

export const log = {
  info(meta: LogMeta, message: string): void {
    console.info(JSON.stringify({ level: "info", message, ...meta }));
  },

  warn(meta: LogMeta, message: string): void {
    console.warn(JSON.stringify({ level: "warn", message, ...meta }));
    try {
      Sentry.captureMessage(message, {
        level: "warning",
        extra: meta,
      });
    } catch {
      // SDK Sentry blip — fuente local (console.warn) ya emitió.
    }
  },

  error(err: unknown, meta: LogMeta, message: string): void {
    const errMessage = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ level: "error", message, errMessage, ...meta }),
      err,
    );
    try {
      Sentry.captureException(err, {
        extra: { message, ...meta },
      });
    } catch {
      // SDK Sentry blip — fuente local (console.error) ya emitió.
    }
  },
};
