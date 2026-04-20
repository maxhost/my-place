import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'
import { prisma } from '@/db/client'
import { createSupabaseServer } from '@/shared/lib/supabase/server'
import { findMemberPermissions } from '@/features/members/public'
import { buildThemeVars, type ThemeConfig } from '@/shared/config/theme'

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

  const supabase = await createSupabaseServer()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) {
    redirect(`/login?next=/${placeSlug}`)
  }

  const place = await loadPlace(placeSlug)
  if (!place || place.archivedAt) {
    notFound()
  }

  const perms = await findMemberPermissions(auth.user.id, place.id)
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
 * Cacheado por request — los layouts de `(gated)` y las páginas hijas pueden
 * llamar `loadPlace(slug)` sin disparar una nueva query.
 */
export const loadPlace = cache(async (slug: string) => {
  return prisma.place.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      archivedAt: true,
      themeConfig: true,
    },
  })
})
