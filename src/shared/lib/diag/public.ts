/**
 * Barrel export del sistema de diagnóstico TEMPORAL.
 * Cleanup pre-launch: borrar todo `src/shared/lib/diag/` + tabla DiagnosticLog
 * + llamadas (`grep -rn 'from .*diag/public' src/`).
 */
export { logDiag } from './log'
export { truncateIp, extractCookieNames, truncateString } from './extract'
export type { DiagEvent, DiagSeverity, DiagSessionState, DiagContext, DiagPayload } from './types'
