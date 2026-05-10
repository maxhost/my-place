import 'server-only'
import { InvitationDeliveryStatus } from '@prisma/client'
import { prisma } from '@/db/client'
import { generateInviteMagicLink } from '@/shared/lib/supabase/admin-links'
import { inviteCallbackUrl } from '@/shared/lib/auth-callback-url'
import { getMailer } from '@/shared/lib/mailer'
import {
  DomainError,
  InvitationEmailFailedError,
  InvitationLinkGenerationError,
} from '@/shared/errors/domain-error'

/**
 * Helpers compartidos por los 4 server actions de members. Privados al
 * directorio — NO se exportan vía `public.ts` del slice. El barrel
 * `actions/index.ts` re-exporta sólo server actions, no estos helpers.
 *
 * `import 'server-only'` garantiza que el bundler de Next nunca arrastre
 * este módulo al bundle cliente incluso si un client component hace un
 * import transitivo accidental.
 */

export const DELIVERY_ERROR_MAX_LEN = 500

export type PlaceWithName = {
  id: string
  slug: string
  name: string
  archivedAt: Date | null
}

export function truncate(s: string, n = DELIVERY_ERROR_MAX_LEN): string {
  return s.length <= n ? s : s.slice(0, n)
}

export async function fetchInviterDisplayName(actorId: string): Promise<string> {
  const inviter = await prisma.user.findUnique({
    where: { id: actorId },
    select: { displayName: true },
  })
  return inviter?.displayName ?? 'Alguien de Place'
}

export async function findPlaceStateBySlugWithName(slug: string): Promise<PlaceWithName | null> {
  return prisma.place.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, archivedAt: true },
  })
}

/**
 * Dispara generateLink + mailer para una invitación y refleja el resultado
 * en la row. Orchestrator: link → send → mark SENT. Cada sub-helper maneja
 * su propio path de error y actualiza `deliveryStatus=FAILED` antes de
 * re-throw.
 *
 * `next` es el path destino post-auth (ej: `/invite/accept/<token>`).
 * Internamente: extraemos `hashed_token` + `type` del payload de Supabase y
 * construimos `inviteUrl` apuntando a `/auth/invite-callback` (server-side
 * verifyOtp). El `action_link` de Supabase (implicit flow) NO se usa.
 * Ver `docs/gotchas/supabase-magic-link-callback-required.md`.
 */
export async function deliverInvitationEmail(params: {
  invitationId: string
  email: string
  next: string
  placeName: string
  placeSlug: string
  inviterDisplayName: string
  expiresAt: Date
}): Promise<void> {
  const link = await generateInviteLinkOrFail(params.invitationId, params.email)
  const inviteUrl = inviteCallbackUrl({
    tokenHash: link.hashedToken,
    type: link.type,
    next: params.next,
  })
  const sendResult = await sendInvitationEmailOrFail(params.invitationId, {
    to: params.email,
    placeName: params.placeName,
    placeSlug: params.placeSlug,
    inviterDisplayName: params.inviterDisplayName,
    inviteUrl,
    expiresAt: params.expiresAt,
  })
  await markInvitationSent(params.invitationId, sendResult.id)
}

/**
 * Link gen: si falla, marca la row como FAILED + re-throw `InvitationLink
 * GenerationError` typed. Preserva el tipo original si ya venía typed.
 */
async function generateInviteLinkOrFail(
  invitationId: string,
  email: string,
): Promise<{ hashedToken: string; type: 'invite' | 'magiclink' }> {
  try {
    const result = await generateInviteMagicLink({ email })
    return { hashedToken: result.hashedToken, type: result.type }
  } catch (err) {
    const reason = err instanceof DomainError ? err.message : String(err)
    await prisma.invitation.update({
      where: { id: invitationId },
      data: {
        deliveryStatus: InvitationDeliveryStatus.FAILED,
        lastDeliveryError: truncate(`link: ${reason}`),
      },
    })
    if (err instanceof InvitationLinkGenerationError) throw err
    throw new InvitationLinkGenerationError(`Falló la generación del magic link: ${reason}`, {
      invitationId,
    })
  }
}

/**
 * Send email: si el mailer falla, marca la row como FAILED + re-throw
 * `InvitationEmailFailedError` typed.
 */
async function sendInvitationEmailOrFail(
  invitationId: string,
  input: {
    to: string
    placeName: string
    placeSlug: string
    inviterDisplayName: string
    inviteUrl: string
    expiresAt: Date
  },
): Promise<{ id: string }> {
  const mailer = getMailer()
  try {
    return await mailer.sendInvitation(input)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    await prisma.invitation.update({
      where: { id: invitationId },
      data: {
        deliveryStatus: InvitationDeliveryStatus.FAILED,
        lastDeliveryError: truncate(`mailer: ${reason}`),
      },
    })
    throw new InvitationEmailFailedError(`El mailer falló al enviar: ${reason}`, {
      invitationId,
      email: input.to,
    })
  }
}

async function markInvitationSent(invitationId: string, providerMessageId: string): Promise<void> {
  await prisma.invitation.update({
    where: { id: invitationId },
    data: {
      deliveryStatus: InvitationDeliveryStatus.SENT,
      providerMessageId,
      lastDeliveryError: null,
      lastSentAt: new Date(),
    },
  })
}
