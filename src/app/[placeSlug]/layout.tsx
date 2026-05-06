import { notFound, redirect } from 'next/navigation'
import { getCurrentAuthUser } from '@/shared/lib/auth-user'
import { findMemberPermissions } from '@/features/members/public.server'
import { listMyPlaces } from '@/features/places/public.server'
import { isPlaceOpen, parseOpeningHours } from '@/features/hours/public'
import { buildThemeVars, type ThemeConfig } from '@/shared/config/theme'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { clientEnv } from '@/shared/config/env'
import { AppShell } from '@/features/shell/public'

type Props = {
  children: React.ReactNode
  params: Promise<{ placeSlug: string }>
}

/**
 * Layout raíz del place. Chequea en orden:
 *  1. Sesión activa (sino → redirect a login con `next=`).
 *  2. Place existe y no está archivado (sino → 404).
 *  3. Visitor es miembro activo o owner del place (sino → 404).
 *
 * NO chequea el horario para gating de contenido — eso vive en
 * `(gated)/layout.tsx`. Pero SÍ deriva `placeClosed` del horario para
 * que el shell muestre los dots deshabilitados (chrome consistente
 * incluso cuando el contenido bajo está cerrado).
 *
 * Monta `<AppShell>` (R.2.2): chrome común con TopBar + community
 * switcher + dots + search trigger. El shell envuelve `{children}`.
 * `/settings/*` también obtiene shell porque está fuera de gated pero
 * dentro de este layout (admin necesita switcher/search desde settings).
 *
 * Ver `docs/features/shell/spec.md` § 10 (mount strategy) y
 * `docs/features/hours/spec.md` § "Arquitectura del gate".
 */
export default async function PlaceLayout({ children, params }: Props) {
  const { placeSlug } = await params

  // auth, place y la lista de places del user son independientes —
  // todos van en paralelo para eliminar RTT del critical path. Cached
  // por React.cache; llamadas posteriores en el mismo render son hits.
  const [auth, place] = await Promise.all([getCurrentAuthUser(), loadPlaceBySlug(placeSlug)])
  if (!auth) {
    redirect(`/login?next=/${placeSlug}`)
  }
  if (!place || place.archivedAt) {
    notFound()
  }

  const [perms, places] = await Promise.all([
    findMemberPermissions(auth.id, place.id),
    listMyPlaces(auth.id),
  ])
  if (!perms.isOwner && !perms.isMember) {
    notFound()
  }

  const themeConfig = (place.themeConfig ?? {}) as ThemeConfig
  // Derivación pure (sin queries): `place.openingHours` ya viene en el
  // Place row. El gate real de contenido sigue en (gated)/layout.tsx;
  // acá solo lo usamos para el chrome.
  const placeClosed = !isPlaceOpen(parseOpeningHours(place.openingHours), new Date()).open

  return (
    <div style={buildThemeVars(themeConfig)} className="min-h-screen">
      <AppShell
        places={places}
        currentSlug={placeSlug}
        apexUrl={clientEnv.NEXT_PUBLIC_APP_URL}
        placeClosed={placeClosed}
      >
        {children}
      </AppShell>
    </div>
  )
}

/**
 * Reexport del loader compartido. Las pages y layouts hijos pueden importar
 * `loadPlace` desde acá (misma carpeta, import corto) o `loadPlaceBySlug`
 * desde `@/shared/lib/place-loader` — ambos resuelven al mismo cache.
 */
export { loadPlaceBySlug as loadPlace } from '@/shared/lib/place-loader'
