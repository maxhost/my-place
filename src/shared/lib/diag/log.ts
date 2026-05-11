import 'server-only'
import { prisma } from '@/db/client'
import { logger } from '@/shared/lib/logger'
import type { DiagContext, DiagEvent, DiagPayload, DiagSeverity } from './types'

/**
 * `logDiag` — escribe un evento de diagnóstico en `DiagnosticLog` (Prisma).
 *
 * **Garantías:**
 * - **Failure-isolated**: si Prisma falla (DB caída, schema mismatch, lo que
 *   sea), atrapa el error y loggea a Pino — NUNCA propaga al request principal.
 * - **Fire-and-forget**: no es `await`able por contrato; corremos el insert
 *   en un microtask para no bloquear la response. El caller no espera.
 * - **Server-only**: importable solo desde Server Components/Routes/Actions.
 *
 * **Privacidad:** el caller decide qué va en `payload`. NO meter:
 * - Cookie values, access tokens, refresh tokens, code-verifier
 * - Email completo (usar `email.split('@')[1]` o un hash)
 * - Body/query con PII
 *
 * Sí podés meter: cookie NAMES, error codes, lengths, booleans, IDs (uuid),
 * hosts, paths, redirect targets.
 *
 * **Cleanup pre-launch:** borrar este archivo + tabla `DiagnosticLog` +
 * todas las llamadas (`grep -rn 'logDiag(' src/`). Ver
 * `docs/pre-launch-checklist.md`.
 */
export function logDiag(
  event: DiagEvent,
  payload: DiagPayload,
  context: DiagContext,
  severity: DiagSeverity = 'info',
): void {
  // Microtask para no bloquear la response del request principal.
  // setImmediate (Node) hace que el insert corra después que el response
  // se haya empezado a enviar.
  setImmediate(() => {
    void writeDiagRow({ event, payload, context, severity }).catch((err) => {
      // Last-resort: si Prisma fallo, loggear el error + el evento original
      // para no perder visibilidad. Triple-defensivo: si logger.error tampoco
      // existe (test mocks incompletos), fallback a console y nunca propagar.
      try {
        if (typeof logger.error === 'function') {
          logger.error(
            {
              event: 'diag_log_write_failed',
              originalEvent: event,
              err: err instanceof Error ? { message: err.message, name: err.name } : err,
            },
            'logDiag write failed (event lost from DiagnosticLog table, see context)',
          )
        } else {
          console.error('logDiag write failed', { originalEvent: event, err })
        }
      } catch {
        // último fallback — no se puede loggear nada, el request principal sigue.
      }
    })
  })
}

async function writeDiagRow(input: {
  event: DiagEvent
  payload: DiagPayload
  context: DiagContext
  severity: DiagSeverity
}): Promise<void> {
  const { event, payload, context, severity } = input
  await prisma.diagnosticLog.create({
    data: {
      event,
      severity,
      traceId: context.traceId,
      host: context.host,
      path: context.path,
      method: context.method,
      userId: context.userId ?? null,
      sessionState: context.sessionState ?? null,
      cookieNames: context.cookieNames ?? [],
      userAgent: context.userAgent ?? null,
      ipPrefix: context.ipPrefix ?? null,
      payload: payload as object,
    },
  })
}
