import { notFound, redirect } from 'next/navigation'
import { getCurrentAuthUser } from '@/shared/lib/auth-user'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { findMemberPermissions } from '@/features/members/public.server'
import { SettingsMobileHub } from '@/features/settings-shell/public'

type Props = { params: Promise<{ placeSlug: string }> }

/**
 * Root `/settings/*` del place. Hoy es placeholder (vista hub con cards de
 * cada section, mismo contenido en mobile y desktop — solo cambia el chrome
 * alrededor: en desktop el `<SettingsShell>` del layout muestra sidebar
 * además del hub; en mobile solo se ve el hub + FAB).
 *
 * Futuro: dashboard del place con métricas/info relevante para admin.
 *
 * Ver `docs/features/settings-shell/spec.md` § "Vista mobile root".
 *
 * Auth/perms: el layout padre (`settings/layout.tsx`) ya gateó admin/owner.
 * Re-resolver acá es safe (queries cacheadas via `React.cache` per-request).
 */
export default async function PlaceSettingsRootPage({ params }: Props) {
  const { placeSlug } = await params

  const [auth, place] = await Promise.all([getCurrentAuthUser(), loadPlaceBySlug(placeSlug)])
  if (!auth) redirect(`/login?next=/settings`)
  if (!place || place.archivedAt) notFound()

  const perms = await findMemberPermissions(auth.id, place.id)
  if (!perms.isAdmin) notFound()

  return <SettingsMobileHub isOwner={perms.isOwner} />
}
