import { notFound, redirect } from 'next/navigation'
import { getCurrentAuthUser } from '@/shared/lib/auth-user'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { findMemberPermissions } from '@/features/members/public'

type Props = {
  children: React.ReactNode
  params: Promise<{ placeSlug: string }>
}

/**
 * Layout compartido de `/settings/*`. Gate único admin/owner — evita duplicar
 * el check en cada página hija. Fuera del route group `(gated)/` a propósito:
 * admin/owner mantienen acceso a settings **incluso con el place cerrado**,
 * porque si no el place recién creado quedaría en deadlock (nace cerrado hasta
 * que se configura horario).
 *
 * Ver `docs/features/hours/spec.md` § "Arquitectura del gate".
 */
export default async function SettingsLayout({ children, params }: Props) {
  const { placeSlug } = await params

  const auth = await getCurrentAuthUser()
  if (!auth) {
    redirect(`/login?next=/settings`)
  }

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) {
    notFound()
  }

  const perms = await findMemberPermissions(auth.id, place.id)
  if (!perms.isOwner && perms.role !== 'ADMIN') {
    notFound()
  }

  return <>{children}</>
}
