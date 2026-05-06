import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getCurrentAuthUser } from '@/shared/lib/auth-user'
import { findPlaceOwnership } from '@/shared/lib/identity-cache'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { findMemberDetailForOwner, hasPermission } from '@/features/members/public.server'
import { BackButton } from '@/shared/ui/back-button'
import { MemberDetailHeader } from './components/member-detail-header'
import { ExpelSection } from './components/expel-section'
import { TiersSectionStreamed, TiersSectionSkeleton } from './_tiers-section'
import { GroupsSectionStreamed, GroupsSectionSkeleton } from './_groups-section'
import { BlockSectionStreamed, BlockSectionSkeleton } from './_block-section'

type Props = {
  params: Promise<{ placeSlug: string; userId: string }>
}

/**
 * Detalle de un miembro del place.
 *
 * Gate del page (defense in depth — `/settings/layout.tsx` ya gateia
 * admin-or-owner):
 *  - Owner → acceso completo.
 *  - Viewer con `members:block` → acceso para usar la sección "Bloquear".
 *  - Otros → 404.
 *
 * Secciones (visibilidad condicional):
 *  - Header: siempre.
 *  - "Tiers asignados" (assign/remove): owner-only.
 *  - "Grupos asignados" (`<MemberGroupsControl>`): owner-only.
 *  - "Bloquear miembro": viewer con `members:block` AND target NO es owner
 *    AND target NO es self. Si ya bloqueado → metadata + dialog "Desbloquear";
 *    si no → dialog "Bloquear".
 *  - "Expulsar miembro": owner AND target NO es owner AND target NO es self.
 *
 * **Modelo de admin**: no hay sección "Rol" en el page. La condición
 * MEMBER↔ADMIN se deriva exclusivamente de la pertenencia al grupo preset
 * "Administradores", que se gestiona desde la sección "Grupos asignados".
 * La columna `Membership.role` fue dropeada en la migration
 * `20260503000100_drop_membership_role`; cualquier check de admin pasa por
 * `is_place_admin` (SQL helper) o el preset group resuelto vía
 * `features/groups`.
 *
 * **Streaming RSC por sección**: la page resuelve sólo el gate (auth +
 * place + permisos) y `findMemberDetailForOwner` antes del primer paint
 * — eso permite evaluar el `notFound()` y pintar el header enseguida.
 * Las secciones pesadas (Tiers, Groups, Block) viven cada una en su
 * propio `_*-section.tsx` Server Component, envuelto en `<Suspense>`,
 * y se desbloquean independientemente cuando su query resuelve.
 * Reduce TTFB cross-region (Vercel us-east-1 ↔ Supabase us-west-2)
 * vs. el `Promise.all` previo que serializaba el primer paint detrás
 * de la query más lenta. La sección "Expel" no tiene queries y queda
 * inline. Spec: docs/features/groups/spec.md § 5.
 *
 * ADR: docs/decisions/2026-05-02-permission-groups-model.md.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { placeSlug, userId } = await params
  const place = await loadPlaceBySlug(placeSlug)
  if (!place) return { title: 'Miembro · Settings' }
  const member = await findMemberDetailForOwner(userId, place.id)
  if (!member) return { title: 'Miembro · Settings' }
  return { title: `${member.user.displayName} · Miembros · Settings` }
}

export default async function SettingsMemberDetailPage({ params }: Props) {
  const { placeSlug, userId } = await params

  const auth = await getCurrentAuthUser()
  if (!auth) {
    redirect(`/login?next=/settings/members/${userId}`)
  }

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) {
    notFound()
  }

  // Gate: owner OR viewer con members:block. Otros → 404 (defense in depth
  // sobre el layout settings que ya gateia admin-or-owner).
  const [viewerCanBlock, viewerIsOwner] = await Promise.all([
    hasPermission(auth.id, place.id, 'members:block'),
    findPlaceOwnership(auth.id, place.id),
  ])
  if (!viewerIsOwner && !viewerCanBlock) {
    notFound()
  }

  // El detalle del miembro se carga antes del primer paint: lo necesita el
  // header (above-the-fold) y el `notFound()` de target inexistente debe
  // resolverse antes de strimear nada.
  const member = await findMemberDetailForOwner(userId, place.id)
  if (!member) {
    notFound()
  }

  const isSelf = member.userId === auth.id
  const targetIsOwner = member.isOwner
  const showBlockSection = viewerCanBlock && !targetIsOwner && !isSelf
  const showExpelSection = viewerIsOwner && !targetIsOwner && !isSelf
  const actorEmail = auth.email ?? ''

  return (
    <div className="space-y-6 px-3 py-6 md:px-4 md:py-8">
      <div>
        <BackButton fallbackHref={`/settings/members`} label="Volver al directorio" />
      </div>

      <MemberDetailHeader member={member} />

      {viewerIsOwner ? (
        <>
          <Suspense fallback={<TiersSectionSkeleton />}>
            <TiersSectionStreamed
              placeSlug={place.slug}
              placeId={place.id}
              memberUserId={member.userId}
            />
          </Suspense>
          <Suspense fallback={<GroupsSectionSkeleton />}>
            <GroupsSectionStreamed placeId={place.id} memberUserId={member.userId} />
          </Suspense>
        </>
      ) : null}

      {showBlockSection ? (
        <Suspense fallback={<BlockSectionSkeleton />}>
          <BlockSectionStreamed
            placeId={place.id}
            memberUserId={member.userId}
            memberDisplayName={member.user.displayName}
            actorEmail={actorEmail}
          />
        </Suspense>
      ) : null}

      {showExpelSection ? (
        <ExpelSection
          placeId={place.id}
          memberUserId={member.userId}
          memberDisplayName={member.user.displayName}
          actorEmail={actorEmail}
        />
      ) : null}
    </div>
  )
}
