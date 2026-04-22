import { NextResponse, type NextRequest } from 'next/server'
import { Webhook, WebhookVerificationError } from 'svix'
import { InvitationDeliveryStatus } from '@prisma/client'
import { prisma } from '@/db/client'
import { serverEnv } from '@/shared/config/env'
import { logger } from '@/shared/lib/logger'
import { RESEND_EVENT_TO_STATUS, canTransitionInvitationDelivery } from '@/features/members/public'

export const runtime = 'nodejs'

/**
 * Webhook de Resend → actualiza `Invitation.deliveryStatus` según eventos
 * `email.{sent,delivered,bounced,complained}`.
 *
 * Firma: svix, con headers `svix-id`, `svix-timestamp`, `svix-signature`.
 *
 * Contract:
 * - 400 si firma falta o es inválida → Resend reintenta (bien).
 * - 200 con body JSON informativo en todo el resto (incluso noop) → Resend no reintenta.
 * - Idempotente: eventos fuera de orden se silencian con `canTransition`.
 *
 * `runtime = 'nodejs'` explícito: svix necesita `crypto` nativo.
 */

const PROCESSABLE_EVENTS = new Set(Object.keys(RESEND_EVENT_TO_STATUS))

type ResendPayload = {
  type: string
  data?: {
    email_id?: string
    // Resend usa distintos nombres por evento. Mantenemos tolerante:
    // - email.bounced → bounce: { ... }
    // - email.complained → (no detail estable)
    bounce?: { message?: string; reason?: string }
    complaint?: { type?: string }
  }
}

export async function POST(req: NextRequest) {
  const secret = serverEnv.RESEND_WEBHOOK_SECRET
  if (!secret) {
    logger.warn('Resend webhook recibido pero RESEND_WEBHOOK_SECRET no está seteado.')
    return NextResponse.json({ error: 'webhook not configured' }, { status: 400 })
  }

  const svixId = req.headers.get('svix-id')
  const svixTimestamp = req.headers.get('svix-timestamp')
  const svixSignature = req.headers.get('svix-signature')
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'missing svix headers' }, { status: 400 })
  }

  const rawBody = await req.text()

  let payload: ResendPayload
  try {
    const wh = new Webhook(secret)
    payload = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ResendPayload
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return NextResponse.json({ error: 'invalid signature' }, { status: 400 })
    }
    logger.error({ err }, 'resend webhook verify failed (unexpected)')
    return NextResponse.json({ error: 'verify failed' }, { status: 400 })
  }

  const eventType = payload.type
  if (!PROCESSABLE_EVENTS.has(eventType)) {
    // Eventos como email.clicked, email.opened, email.scheduled: ack + ignore.
    return NextResponse.json({ received: true, ignored: eventType }, { status: 200 })
  }

  const providerMessageId = payload.data?.email_id
  if (!providerMessageId) {
    logger.warn({ eventType }, 'resend webhook sin email_id en data')
    return NextResponse.json({ received: true, noop: 'no_email_id' }, { status: 200 })
  }

  const nextStatus = RESEND_EVENT_TO_STATUS[eventType]
  if (!nextStatus) {
    return NextResponse.json({ received: true, ignored: eventType }, { status: 200 })
  }

  const invitation = await prisma.invitation.findFirst({
    where: { providerMessageId },
    select: { id: true, deliveryStatus: true },
  })
  if (!invitation) {
    // El email_id puede corresponder a envíos ajenos (share de key entre apps) o
    // a una invitación ya borrada manualmente. No es error.
    return NextResponse.json({ received: true, noop: 'no_invitation' }, { status: 200 })
  }

  if (!canTransitionInvitationDelivery(invitation.deliveryStatus, nextStatus)) {
    return NextResponse.json(
      {
        received: true,
        noop: 'transition_not_allowed',
        from: invitation.deliveryStatus,
        to: nextStatus,
      },
      { status: 200 },
    )
  }

  const bounceReason =
    nextStatus === InvitationDeliveryStatus.BOUNCED
      ? (payload.data?.bounce?.message ?? payload.data?.bounce?.reason ?? 'bounce')
      : null

  await prisma.invitation.update({
    where: { id: invitation.id },
    data: {
      deliveryStatus: nextStatus,
      lastDeliveryError: bounceReason ? truncate(bounceReason) : null,
    },
  })

  logger.info(
    {
      event: 'invitationDeliveryUpdated',
      invitationId: invitation.id,
      from: invitation.deliveryStatus,
      to: nextStatus,
      resendEvent: eventType,
    },
    'invitation delivery status updated via webhook',
  )

  return NextResponse.json(
    { received: true, invitationId: invitation.id, status: nextStatus },
    { status: 200 },
  )
}

function truncate(s: string, n = 500): string {
  return s.length <= n ? s : s.slice(0, n)
}
