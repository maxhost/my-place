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
 * Actor resuelto para una acción en el contexto de un place.
 * Se usa como primer paso en toda write action del slice `discussions`.
 *
 * `isAdmin` = rol `ADMIN` *o* ownership en `PlaceOwnership`. Owners heredan
 * permisos de admin sobre el contenido (hide/delete/reviewFlag).
 */
export type DiscussionActor = {
  actorId: string
  /** Alias de `actorId`. Satisface `ActorContext` de invariantes sin duplicar args. */
  userId: string
  placeId: string
  placeSlug: string
  membership: { id: string; role: MembershipRole }
  isAdmin: boolean
  user: {
    displayName: string
    avatarUrl: string | null
  }
}

/**
 * Carga la sesión de Supabase y exige `Membership` activa en el place indicado.
 * La combinación `(auth, place, membership, ownership, user snapshot)` sale de
 * primitives cached por request (`getCurrentAuthUser`, `loadPlaceBySlug`,
 * `loadPlaceById`, `findActiveMembership`, `findPlaceOwnership`,
 * `findUserProfile`). Eso hace que:
 *  - el árbol layout → gated layout → page comparta los round-trips,
 *  - un action que se invoca dentro del mismo request que un render también
 *    reuse el resultado.
 *
 * Errores:
 *  - `AuthorizationError` si no hay sesión.
 *  - `NotFoundError` si el place no existe o está archivado.
 *  - `AuthorizationError` si no hay membership activa.
 *
 * Ver `docs/decisions/2026-04-20-request-scoped-identity-cache.md`.
 */
export async function resolveActorForPlace(params: {
  placeSlug?: string
  placeId?: string
}): Promise<DiscussionActor> {
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
    userId: actorId,
    placeId: place.id,
    placeSlug: place.slug,
    membership,
    isAdmin: membership.role === 'ADMIN' || isOwner,
    user,
  }
}

/**
 * Alias público estable para el UI layer. Usa el mismo resolver que las actions,
 * pero el nombre comunica mejor la intención: en pages/server-components se lee
 * "viewer", no "actor".
 */
export const resolveViewerForPlace = resolveActorForPlace
export type DiscussionViewer = DiscussionActor
