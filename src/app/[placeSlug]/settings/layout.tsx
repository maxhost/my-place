import { notFound, redirect } from 'next/navigation'
import { getCurrentAuthUser } from '@/shared/lib/auth-user'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { findMemberPermissions } from '@/features/members/public.server'
import { SettingsNavFab } from '@/features/shell/public'
import { SettingsShell } from '@/features/settings-shell/public'

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

  // **Shell de settings (rediseño desktop, Sub-sesión 1c)**:
  //  - Desktop: <SettingsShell> renderea sidebar 240px a la izquierda + content
  //    area max-w-screen-md a la derecha. Children van adentro del content area.
  //  - Mobile: el sidebar está oculto (CSS `hidden md:flex`); el FAB queda
  //    visible (wrapper `md:hidden`) como único affordance de navegación.
  //  - Coexisten por viewport, no se reemplazan en JS (sin hydration concerns).
  //
  // El active state del sidebar lo resuelve `usePathname()` client-side
  // (ver `<Sidebar>` primitive). NO pasamos `currentPath` desde acá porque
  // Next no re-ejecuta este layout en client navigation entre rutas
  // hermanas — cualquier valor server-rendered queda stale.
  //
  // Ver `docs/features/settings-shell/spec.md`.

  return (
    <>
      <SettingsShell isOwner={perms.isOwner}>{children}</SettingsShell>
      <div className="md:hidden">
        <SettingsNavFab isOwner={perms.isOwner} />
      </div>
    </>
  )
}
