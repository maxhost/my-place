import 'server-only'
import type { MembershipRole } from '@prisma/client'
import { getCurrentAuthUser } from '@/shared/lib/auth-user'
import {
  findActiveMembership,
  findPlaceOwnership,
  findUserProfile,
} from '@/shared/lib/identity-cache'
import { loadPlaceById, loadPlaceBySlug } from '@/shared/lib/place-loader'
import { AuthorizationError, NotFoundError } from '@/shared/errors/domain-error'

/**
 * Actor resuelto para una acción del slice `flags`. Semánticamente idéntico a
 * `DiscussionActor`: un user + su contexto en un place + si es admin
 * (rol `ADMIN` o `PlaceOwnership`). Duplicado acá a propósito para que `flags`
 * no dependa de `discussions/server/actor` — ver
 * `docs/decisions/2026-04-21-flags-subslice-split.md` §3. Si a futuro un
 * tercer slice necesita el mismo helper, candidato a subir a `shared/lib/`.
 *
 * Ver `docs/decisions/2026-04-20-request-scoped-identity-cache.md`.
 */
export type FlagActor = {
  actorId: string
  placeId: string
  placeSlug: string
  membership: { id: string; role: MembershipRole }
  isAdmin: boolean
  user: {
    displayName: string
    avatarUrl: string | null
  }
}

export async function resolveActorForPlace(params: {
  placeSlug?: string
  placeId?: string
}): Promise<FlagActor> {
  const auth = await getCurrentAuthUser()
  if (!auth) {
    throw new AuthorizationError('Necesitás iniciar sesión.')
  }
  const actorId = auth.id

  const place = params.placeSlug
    ? await loadPlaceBySlug(params.placeSlug)
    : params.placeId
      ? await loadPlaceById(params.placeId)
      : null
  if (!place) {
    throw new NotFoundError('Place no indicado o no encontrado.', params)
  }
  if (place.archivedAt) {
    throw new NotFoundError('Place archivado.', { placeId: place.id })
  }

  const [membership, isOwner, user] = await Promise.all([
    findActiveMembership(actorId, place.id),
    findPlaceOwnership(actorId, place.id),
    findUserProfile(actorId),
  ])

  if (!membership || !user) {
    throw new AuthorizationError('No sos miembro activo de este place.', {
      placeId: place.id,
      actorId,
    })
  }

  return {
    actorId,
    placeId: place.id,
    placeSlug: place.slug,
    membership,
    isAdmin: membership.role === 'ADMIN' || isOwner,
    user,
  }
}
