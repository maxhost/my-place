import type { Metadata } from 'next'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { findGroupById } from '@/features/groups/public.server'
import { GroupDetailContent } from '../_group-detail-content'

type Props = {
  params: Promise<{ placeSlug: string; groupId: string }>
}

/**
 * Detalle de un grupo de permisos — full page (mobile y standalone desktop).
 *
 * En desktop con master-detail (Sesión 3 plan settings desktop), el slot
 * `@detail/[groupId]/page.tsx` también renderea el detail al lado de la
 * lista. Este page sigue siendo el "fallback" para mobile (donde no hay
 * split view) y para deep links directos.
 *
 * La lógica de gate + queries + render vive en
 * `_group-detail-content.tsx` para no duplicarse entre el page y el slot.
 *
 * Ver `docs/features/groups/spec.md` § 5 + ADR
 * `2026-05-02-permission-groups-model.md`.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { placeSlug, groupId } = await params
  const place = await loadPlaceBySlug(placeSlug)
  if (!place) return { title: 'Grupo · Settings' }
  const group = await findGroupById(groupId)
  if (!group) return { title: 'Grupo · Settings' }
  return { title: `${group.name} · Grupos · Settings` }
}

export default async function SettingsGroupDetailPage({ params }: Props) {
  const { placeSlug, groupId } = await params
  return <GroupDetailContent placeSlug={placeSlug} groupId={groupId} showBackLink />
}
