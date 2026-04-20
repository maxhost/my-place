import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/db/client'
import { createSupabaseServer } from '@/shared/lib/supabase/server'
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

  const supabase = await createSupabaseServer()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) {
    redirect(`/login?next=/${placeSlug}/settings`)
  }

  const place = await prisma.place.findUnique({
    where: { slug: placeSlug },
    select: { id: true, archivedAt: true },
  })
  if (!place || place.archivedAt) {
    notFound()
  }

  const perms = await findMemberPermissions(auth.user.id, place.id)
  if (!perms.isOwner && perms.role !== 'ADMIN') {
    notFound()
  }

  return <>{children}</>
}
