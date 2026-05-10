'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { logger } from '@/shared/lib/logger'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'
import { inviteMemberSchema, type InviteMemberInput } from '@/features/members/schemas'
import {
  assertPlaceActive,
  assertPlaceHasCapacity,
  generateInvitationToken,
  INVITATION_TTL_DAYS,
} from '@/features/members/domain/invariants'
import { countActiveMemberships } from '@/features/members/server/queries'
import { hasPermission } from '@/features/members/server/permissions'
import { findPlaceOwnership } from '@/shared/lib/identity-cache'
import { requireAuthUserId } from '@/shared/lib/auth-user'
import {
  deliverInvitationEmail,
  fetchInviterDisplayName,
  findPlaceStateBySlugWithName,
  type PlaceWithName,
} from '@/features/members/invitations/server/actions/shared'

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
  const data = parseInviteInput(input)
  const actorId = await requireAuthUserId('Necesitás iniciar sesión para invitar.')
  const place = await assertInvitablePlace(data.placeSlug, actorId, data.asAdmin, data.asOwner)

  const token = generateInvitationToken()
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000)
  const invitationId = await insertInvitationOrConflict(data, place.id, actorId, token, expiresAt)

  await deliverInvitationEmail({
    invitationId,
    email: data.email,
    next: `/invite/accept/${token}`,
    placeName: place.name,
    placeSlug: place.slug,
    inviterDisplayName: await fetchInviterDisplayName(actorId),
    expiresAt,
  })

  logger.info(
    {
      event: 'invitationSent',
      placeId: place.id,
      invitationId,
      invitedBy: actorId,
      asAdmin: data.asAdmin,
      asOwner: data.asOwner,
    },
    'invitation sent',
  )

  // M.4 (plan TierMemberships): el form de invitar + lista de invitaciones
  // pendientes viven en /settings/access (rename del antiguo /settings/members).
  revalidatePath(`/${place.slug}/settings/access`)
  return { ok: true, invitationId }
}

function parseInviteInput(input: unknown): InviteMemberInput {
  const parsed = inviteMemberSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para invitar.', { issues: parsed.error.issues })
  }
  return parsed.data
}

async function assertInvitablePlace(
  slug: string,
  actorId: string,
  asAdmin: boolean,
  asOwner: boolean,
): Promise<PlaceWithName> {
  const place = await findPlaceStateBySlugWithName(slug)
  if (!place) throw new NotFoundError('Place no encontrado.', { slug })
  assertPlaceActive(place)
  // Gate atómico permission-groups + invariant histórico.
  // - asOwner=true → OWNER-ONLY: sólo un owner existente puede invitar a
  //   alguien para sumarse como co-owner (acepta invitation → Membership +
  //   PlaceOwnership en tx).
  // - asAdmin=true → OWNER-ONLY también (decisión ADR #2: "members:invite-admin"
  //   no es permiso atómico).
  // - Default (member común) → permiso `members:invite` delegable.
  // Post-cleanup C.3: `hasPermission` ya no tiene fallback role; resuelve por
  // owner-bypass + membership a un grupo con el permiso.
  if (asOwner || asAdmin) {
    const isOwner = await findPlaceOwnership(actorId, place.id)
    if (!isOwner) {
      const reason = asOwner ? 'owner' : 'admin'
      throw new AuthorizationError(`Sólo el owner puede invitar como ${reason}.`, {
        placeId: place.id,
        actorId,
      })
    }
  } else {
    const allowed = await hasPermission(actorId, place.id, 'members:invite')
    if (!allowed) {
      throw new AuthorizationError('No tenés permiso para invitar miembros.', {
        placeId: place.id,
        actorId,
      })
    }
  }
  const activeCount = await countActiveMemberships(place.id)
  assertPlaceHasCapacity(activeCount)
  return place
}

async function insertInvitationOrConflict(
  data: InviteMemberInput,
  placeId: string,
  actorId: string,
  token: string,
  expiresAt: Date,
): Promise<string> {
  try {
    const created = await prisma.invitation.create({
      data: {
        placeId,
        email: data.email,
        invitedBy: actorId,
        asAdmin: data.asAdmin,
        asOwner: data.asOwner,
        token,
        expiresAt,
      },
      select: { id: true },
    })
    return created.id
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('Ya existe una invitación abierta para este email.', {
        placeId,
        reason: 'already_open',
      })
    }
    throw err
  }
}
