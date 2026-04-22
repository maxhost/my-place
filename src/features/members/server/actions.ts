'use server'

import { revalidatePath } from 'next/cache'
import { InvitationDeliveryStatus, MembershipRole, Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { createSupabaseServer } from '@/shared/lib/supabase/server'
import { generateInviteMagicLink } from '@/shared/lib/supabase/admin-links'
import { getMailer } from '@/shared/lib/mailer'
import { logger } from '@/shared/lib/logger'
import { clientEnv } from '@/shared/config/env'
import {
  AuthorizationError,
  ConflictError,
  DomainError,
  InvariantViolation,
  InvitationEmailFailedError,
  InvitationLinkGenerationError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'
import {
  inviteMemberSchema,
  resendInvitationSchema,
  type InviteMemberInput,
  type ResendInvitationInput,
} from '../schemas'
import {
  assertInviterHasRole,
  assertPlaceActive,
  assertPlaceHasCapacity,
  generateInvitationToken,
  INVITATION_TTL_DAYS,
} from '../domain/invariants'
import {
  countActiveMemberships,
  findActiveMembership,
  findInvitationById,
  findInvitationByToken,
  findInviterPermissions,
  findPlaceStateBySlug,
} from './queries'

const DELIVERY_ERROR_MAX_LEN = 500

function truncate(s: string, n = DELIVERY_ERROR_MAX_LEN): string {
  return s.length <= n ? s : s.slice(0, n)
}

/**
 * Crea una Invitation, genera magic link via Supabase admin (sin envío), y
 * dispara el email por Resend. Ver `docs/plans/2026-04-20-members-email-resend.md`.
 *
 * Orden y garantías:
 * 1. Tx corta: `INSERT Invitation (deliveryStatus=PENDING)`. Si P2002 → ConflictError.
 * 2. Fuera de tx: `generateInviteMagicLink` (invite→magiclink fallback para users que ya existen en `auth.users`).
 * 3. Fuera de tx: `mailer.sendInvitation`. Éxito → UPDATE deliveryStatus=SENT + providerMessageId.
 * 4. Fallo en step 2 o 3: la row queda persistida; el admin ve la invitación en la UI
 *    con `PENDING` o `FAILED` y puede reenviar manualmente.
 */
export async function inviteMemberAction(
  input: unknown,
): Promise<{ ok: true; invitationId: string }> {
  const parsed = inviteMemberSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para invitar.', {
      issues: parsed.error.issues,
    })
  }
  const data: InviteMemberInput = parsed.data

  const supabase = await createSupabaseServer()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) {
    throw new AuthorizationError('Necesitás iniciar sesión para invitar.')
  }
  const actorId = auth.user.id

  const place = await findPlaceStateBySlugWithName(data.placeSlug)
  if (!place) {
    throw new NotFoundError('Place no encontrado.', { slug: data.placeSlug })
  }
  assertPlaceActive(place)

  const perms = await findInviterPermissions(actorId, place.id)
  assertInviterHasRole(perms)

  const activeCount = await countActiveMemberships(place.id)
  assertPlaceHasCapacity(activeCount)

  const token = generateInvitationToken()
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000)
  const redirectTo = `${clientEnv.NEXT_PUBLIC_APP_URL}/invite/accept/${token}`

  let invitationId: string
  try {
    const created = await prisma.invitation.create({
      data: {
        placeId: place.id,
        email: data.email,
        invitedBy: actorId,
        asAdmin: data.asAdmin,
        token,
        expiresAt,
      },
      select: { id: true },
    })
    invitationId = created.id
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('Ya existe una invitación abierta para este email.', {
        placeId: place.id,
        reason: 'already_open',
      })
    }
    throw err
  }

  const inviter = await prisma.user.findUnique({
    where: { id: actorId },
    select: { displayName: true },
  })
  const inviterDisplayName = inviter?.displayName ?? 'Alguien de Place'

  await deliverInvitationEmail({
    invitationId,
    email: data.email,
    redirectTo,
    placeName: place.name,
    placeSlug: place.slug,
    inviterDisplayName,
    expiresAt,
  })

  logger.info(
    {
      event: 'invitationSent',
      placeId: place.id,
      invitationId,
      invitedBy: actorId,
      asAdmin: data.asAdmin,
    },
    'invitation sent',
  )

  revalidatePath(`/${place.slug}/settings/members`)
  return { ok: true, invitationId }
}

/**
 * Reenvía el email de una invitación pending: regenera magic link y vuelve a
 * disparar el mailer. No rota el token — el link del email anterior sigue
 * siendo válido (los magic links de Supabase tienen TTL propio de 1h; el token
 * de `Invitation` vive 7 días).
 */
export async function resendInvitationAction(
  input: unknown,
): Promise<{ ok: true; invitationId: string }> {
  const parsed = resendInvitationSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para reenviar.', {
      issues: parsed.error.issues,
    })
  }
  const { invitationId }: ResendInvitationInput = parsed.data

  const supabase = await createSupabaseServer()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) {
    throw new AuthorizationError('Necesitás iniciar sesión para reenviar.')
  }
  const actorId = auth.user.id

  const invitation = await findInvitationById(invitationId)
  if (!invitation) {
    throw new NotFoundError('Invitación no encontrada.', { invitationId })
  }
  if (invitation.acceptedAt) {
    throw new ConflictError('Esta invitación ya fue aceptada.', {
      invitationId,
      reason: 'already_accepted',
    })
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    throw new ValidationError('Esta invitación ya venció.', {
      invitationId,
      reason: 'expired',
    })
  }
  assertPlaceActive(invitation.place)

  const perms = await findInviterPermissions(actorId, invitation.placeId)
  assertInviterHasRole(perms)

  const redirectTo = `${clientEnv.NEXT_PUBLIC_APP_URL}/invite/accept/${invitation.token}`
  const inviter = await prisma.user.findUnique({
    where: { id: actorId },
    select: { displayName: true },
  })
  const inviterDisplayName = inviter?.displayName ?? 'Alguien de Place'

  await deliverInvitationEmail({
    invitationId: invitation.id,
    email: invitation.email,
    redirectTo,
    placeName: invitation.place.name,
    placeSlug: invitation.place.slug,
    inviterDisplayName,
    expiresAt: invitation.expiresAt,
  })

  logger.info(
    {
      event: 'invitationResent',
      placeId: invitation.placeId,
      invitationId: invitation.id,
      actorId,
    },
    'invitation resent',
  )

  revalidatePath(`/${invitation.place.slug}/settings/members`)
  return { ok: true, invitationId: invitation.id }
}

/**
 * Dispara generateLink + mailer, y refleja el resultado en la row:
 * - éxito → deliveryStatus=SENT + providerMessageId + lastSentAt
 * - fallo link gen → deliveryStatus=FAILED + lastDeliveryError, re-throw typed
 * - fallo mailer → deliveryStatus=FAILED + lastDeliveryError, re-throw typed
 */
async function deliverInvitationEmail(params: {
  invitationId: string
  email: string
  redirectTo: string
  placeName: string
  placeSlug: string
  inviterDisplayName: string
  expiresAt: Date
}): Promise<void> {
  const { invitationId, email, redirectTo, placeName, placeSlug, inviterDisplayName, expiresAt } =
    params
  let linkResult: { url: string; isNewAuthUser: boolean }
  try {
    linkResult = await generateInviteMagicLink({ email, redirectTo })
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

  const mailer = getMailer()
  let sendResult
  try {
    sendResult = await mailer.sendInvitation({
      to: email,
      placeName,
      placeSlug,
      inviterDisplayName,
      inviteUrl: linkResult.url,
      expiresAt,
    })
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
      email,
    })
  }

  await prisma.invitation.update({
    where: { id: invitationId },
    data: {
      deliveryStatus: InvitationDeliveryStatus.SENT,
      providerMessageId: sendResult.id,
      lastDeliveryError: null,
      lastSentAt: new Date(),
    },
  })
}

async function findPlaceStateBySlugWithName(
  slug: string,
): Promise<{ id: string; slug: string; name: string; archivedAt: Date | null } | null> {
  return prisma.place.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, archivedAt: true },
  })
}

/**
 * Canjea un token de invitación por una `Membership` activa en el place.
 * Idempotente: aceptar el mismo token dos veces no duplica la membership
 * ni relanza error (retorna `alreadyMember: true`).
 * Ver `docs/features/members/spec.md` § "Aceptar".
 */
export async function acceptInvitationAction(
  token: unknown,
): Promise<{ ok: true; placeSlug: string; alreadyMember: boolean }> {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new ValidationError('Token de invitación inválido.')
  }

  const supabase = await createSupabaseServer()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) {
    throw new AuthorizationError('Necesitás iniciar sesión para aceptar la invitación.')
  }
  const actorId = auth.user.id

  const invitation = await findInvitationByToken(token)
  if (!invitation) {
    throw new NotFoundError('Invitación no encontrada.', { reason: 'invalid_token' })
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    throw new ValidationError('La invitación expiró.', {
      reason: 'expired',
      expiresAt: invitation.expiresAt,
    })
  }
  assertPlaceActive(invitation.place)

  if (invitation.acceptedAt) {
    const existing = await findActiveMembership(actorId, invitation.placeId)
    if (existing) {
      logger.info(
        {
          event: 'invitationAccepted',
          placeId: invitation.placeId,
          invitationId: invitation.id,
          userId: actorId,
          alreadyMember: true,
        },
        'invitation idempotent accept',
      )
      return { ok: true, placeSlug: invitation.place.slug, alreadyMember: true }
    }
    throw new ConflictError('Esta invitación ya fue usada por otra persona.', {
      reason: 'already_used',
    })
  }

  let alreadyMember = false
  try {
    alreadyMember = await prisma.$transaction(async (tx) => {
      const existing = await tx.membership.findFirst({
        where: { userId: actorId, placeId: invitation.placeId, leftAt: null },
        select: { id: true },
      })

      if (existing) {
        await tx.invitation.updateMany({
          where: { id: invitation.id, acceptedAt: null },
          data: { acceptedAt: new Date() },
        })
        return true
      }

      const activeCount = await tx.membership.count({
        where: { placeId: invitation.placeId, leftAt: null },
      })
      assertPlaceHasCapacity(activeCount)

      await tx.membership.create({
        data: {
          userId: actorId,
          placeId: invitation.placeId,
          role: invitation.asAdmin ? MembershipRole.ADMIN : MembershipRole.MEMBER,
        },
      })

      await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      })

      return false
    })
  } catch (err) {
    // P2002 en `Membership` = race con otro accept (misma sesión en dos tabs, o
    // una membership previa con `leftAt IS NOT NULL` que choca con `@@unique`).
    // Re-joins post-leave no están soportados en MVP — gap documentado en la spec.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError(
        'No pudimos crear la membresía (posible carrera o re-joining no soportado).',
        { reason: 'membership_conflict', invitationId: invitation.id },
      )
    }
    throw err
  }

  logger.info(
    {
      event: 'invitationAccepted',
      placeId: invitation.placeId,
      invitationId: invitation.id,
      userId: actorId,
      role: invitation.asAdmin ? 'ADMIN' : 'MEMBER',
      alreadyMember,
    },
    'invitation accepted',
  )

  revalidatePath('/inbox')
  revalidatePath(`/${invitation.place.slug}`)

  return { ok: true, placeSlug: invitation.place.slug, alreadyMember }
}

/**
 * Sale del place: setea `Membership.leftAt = now()`. Si el actor era owner, también
 * remueve su `PlaceOwnership`. Si era **el único** owner, falla con `InvariantViolation`
 * — debe transferir ownership antes.
 *
 * Concurrencia: usa `SELECT ... FOR UPDATE` sobre `PlaceOwnership` del place dentro de
 * la tx, así dos owners que hacen leave simultáneo se serializan y el segundo falla.
 * Ver `docs/features/members/spec.md` § "Salir".
 */
export async function leaveMembershipAction(
  placeSlug: unknown,
): Promise<{ ok: true; placeSlug: string }> {
  if (typeof placeSlug !== 'string' || placeSlug.trim() === '') {
    throw new ValidationError('Slug del place inválido.')
  }

  const supabase = await createSupabaseServer()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) {
    throw new AuthorizationError('Necesitás iniciar sesión para salir de un place.')
  }
  const actorId = auth.user.id

  const place = await findPlaceStateBySlug(placeSlug)
  if (!place) {
    throw new NotFoundError('Place no encontrado.', { slug: placeSlug })
  }
  assertPlaceActive(place)

  const membership = await findActiveMembership(actorId, place.id)
  if (!membership) {
    throw new NotFoundError('No sos miembro activo de este place.', {
      placeId: place.id,
      actorId,
    })
  }

  await prisma.$transaction(async (tx) => {
    // Lock de fila pesimista sobre TODAS las ownerships del place. Serializa owners
    // concurrentes: si dos owners ejecutan leave al mismo tiempo, el segundo espera
    // y lee el estado ya modificado por el primero — uno gana, el otro falla.
    await tx.$queryRaw`SELECT id FROM "PlaceOwnership" WHERE "placeId" = ${place.id} FOR UPDATE`

    const ownerships = await tx.placeOwnership.findMany({
      where: { placeId: place.id },
      select: { userId: true },
    })
    const actorIsOwner = ownerships.some((o) => o.userId === actorId)

    if (actorIsOwner && ownerships.length === 1) {
      throw new InvariantViolation('Sos el único owner. Transferí la ownership antes de salir.', {
        reason: 'last_owner',
        placeId: place.id,
        actorId,
      })
    }

    if (actorIsOwner) {
      await tx.placeOwnership.delete({
        where: { userId_placeId: { userId: actorId, placeId: place.id } },
      })
    }

    await tx.membership.update({
      where: { id: membership.id },
      data: { leftAt: new Date() },
    })
  })

  logger.info({ event: 'memberLeft', placeId: place.id, actorId }, 'member left place')

  revalidatePath('/inbox')
  revalidatePath(`/${place.slug}`)

  return { ok: true, placeSlug: place.slug }
}
