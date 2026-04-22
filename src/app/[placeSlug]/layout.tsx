import { notFound, redirect } from 'next/navigation'
import { getCurrentAuthUser } from '@/shared/lib/auth-user'
import { findMemberPermissions } from '@/features/members/public'
import { buildThemeVars, type ThemeConfig } from '@/shared/config/theme'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'

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
 * NO chequea el horario — eso vive en `(gated)/layout.tsx`. Todas las rutas
 * sensibles al horario están dentro de ese route group; `/settings/*` queda
 * fuera a propósito para que admin/owner pueda configurar el horario incluso
 * con el place cerrado.
 *
 * Ver `docs/features/hours/spec.md` § "Arquitectura del gate".
 */
export default async function PlaceLayout({ children, params }: Props) {
  const { placeSlug } = await params

  const auth = await getCurrentAuthUser()
  if (!auth) {
    redirect(`/login?next=/${placeSlug}`)
  }

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) {
    notFound()
  }

  const perms = await findMemberPermissions(auth.id, place.id)
  if (!perms.isOwner && !perms.role) {
    notFound()
  }

  const themeConfig = (place.themeConfig ?? {}) as ThemeConfig

  return (
    <div style={buildThemeVars(themeConfig)} className="min-h-screen bg-place text-place-text">
      {children}
    </div>
  )
}

/**
 * Reexport del loader compartido. Las pages y layouts hijos pueden importar
 * `loadPlace` desde acá (misma carpeta, import corto) o `loadPlaceBySlug`
 * desde `@/shared/lib/place-loader` — ambos resuelven al mismo cache.
 */
export { loadPlaceBySlug as loadPlace } from '@/shared/lib/place-loader'
