import { InvitationDeliveryStatus } from '@prisma/client'

/**
 * Máquina de estados de `Invitation.deliveryStatus`.
 *
 * Resend manda los webhooks `email.{sent,delivered,bounced,complained}` en
 * orden normalmente, pero puede haber reintentos + entrega desordenada. Para
 * que el handler sea idempotente y no bailar entre estados, definimos un
 * **rank** y solo permitimos transiciones que suben (o se mantienen) en el
 * rank.
 *
 * Ej: si ya tenemos `DELIVERED`, un `email.sent` tardío no nos baja a `SENT`.
 *
 * `BOUNCED` y `COMPLAINED` son terminales — una vez marcados, no revertimos
 * aunque llegue un evento posterior (defensive: Resend no re-delivery tras bounce).
 */
const STATUS_RANK: Record<InvitationDeliveryStatus, number> = {
  PENDING: 0,
  FAILED: 1,
  SENT: 2,
  DELIVERED: 3,
  BOUNCED: 4,
  COMPLAINED: 4,
}

export function canTransition(
  current: InvitationDeliveryStatus,
  next: InvitationDeliveryStatus,
): boolean {
  // Idempotencia: mismo estado entrante es no-op aceptado.
  if (current === next) return true
  // Nunca salir de un terminal (BOUNCED/COMPLAINED).
  if (current === InvitationDeliveryStatus.BOUNCED) return false
  if (current === InvitationDeliveryStatus.COMPLAINED) return false
  return STATUS_RANK[next] >= STATUS_RANK[current]
}

export const RESEND_EVENT_TO_STATUS: Record<string, InvitationDeliveryStatus | undefined> = {
  'email.sent': InvitationDeliveryStatus.SENT,
  'email.delivered': InvitationDeliveryStatus.DELIVERED,
  'email.bounced': InvitationDeliveryStatus.BOUNCED,
  'email.complained': InvitationDeliveryStatus.COMPLAINED,
}
