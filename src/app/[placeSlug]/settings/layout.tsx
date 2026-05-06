import { notFound, redirect } from 'next/navigation'
import { getCurrentAuthUser } from '@/shared/lib/auth-user'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { findMemberPermissions } from '@/features/members/public.server'
import { SettingsNavFab } from '@/features/shell/public'

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

  // Perf #2.1: `getCurrentAuthUser()` y `loadPlaceBySlug()` son independientes
  // (auth lee cookies/headers; place lee Postgres por slug — no requiere
  // auth.id). Lanzarlos en paralelo elimina un RTT del critical path antes
  // del primer JSX. `findMemberPermissions(auth.id, place.id)` SÍ depende de
  // ambos, así que queda serial. React.cache memoiza los queries internos
  // de `findMemberPermissions` por request: si el outer `[placeSlug]/layout`
  // ya las disparó, esto es cache hit.
  const [auth, place] = await Promise.all([getCurrentAuthUser(), loadPlaceBySlug(placeSlug)])
  if (!auth) {
    redirect(`/login?next=/settings`)
  }
  if (!place || place.archivedAt) {
    notFound()
  }

  const perms = await findMemberPermissions(auth.id, place.id)
  if (!perms.isAdmin) {
    notFound()
  }

  // FAB de sub-navegación entre settings — único affordance para saltar entre
  // General · Horarios · Biblioteca · Acceso · Miembros · Reportes sin volver
  // al inbox. Sibling de `{children}` (no wrapper), patrón coherente con
  // `<ZoneFab>` en `(gated)/layout.tsx`. Visibilidad gateada por este layout
  // (admin/owner ya validado arriba); el componente no es admin-aware.
  return (
    <>
      {children}
      <SettingsNavFab isOwner={perms.isOwner} />
    </>
  )
}
