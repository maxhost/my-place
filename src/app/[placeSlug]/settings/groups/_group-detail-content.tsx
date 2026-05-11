import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getCurrentAuthUser } from '@/shared/lib/auth-user'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { findMemberPermissions, listActiveMembers } from '@/features/members/public.server'
import { GroupDetailView } from '@/features/groups/public'
import { findGroupById, listMembershipsByGroup } from '@/features/groups/public.server'
import { listLibraryCategories } from '@/features/library/public.server'
import { PageHeader } from '@/shared/ui/page-header'

/**
 * Content compartido del detail de un grupo. Único consumer hoy:
 * `[groupId]/page.tsx`, que se renderea como `{children}` del layout
 * master-detail (post-fix Sesión 3).
 *
 * El back link "← Volver a Grupos" tiene `md:hidden`: visible solo en
 * mobile (donde el detail ocupa full screen y la lista no se ve);
 * oculto en desktop (donde la lista master pane ya está visible al lado
 * y el back link sería ruido).
 */
type Props = {
  placeSlug: string
  groupId: string
}

export async function GroupDetailContent({ placeSlug, groupId }: Props): Promise<React.ReactNode> {
  const auth = await getCurrentAuthUser()
  if (!auth) {
    redirect(`/login?next=/settings/groups/${groupId}`)
  }

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) {
    notFound()
  }

  const perms = await findMemberPermissions(auth.id, place.id)
  if (!perms.isOwner) {
    notFound()
  }

  const group = await findGroupById(groupId)
  if (!group || group.placeId !== place.id) {
    notFound()
  }

  const [members, categories, activeMembers] = await Promise.all([
    listMembershipsByGroup(group.id),
    listLibraryCategories(place.id),
    listActiveMembers(place.id),
  ])

  const categoryOptions = categories.map((c) => ({
    id: c.id,
    emoji: c.emoji,
    title: c.title,
  }))

  const memberIds = new Set(members.map((m) => m.userId))
  const availableMembers = activeMembers
    .filter((m) => !m.isOwner && !memberIds.has(m.userId))
    .map((m) => ({
      userId: m.userId,
      displayName: m.user.displayName,
      handle: m.user.handle,
      avatarUrl: m.user.avatarUrl,
    }))

  return (
    <div className="space-y-6 px-3 py-6 md:px-4 md:py-8">
      <Link
        href="/settings/groups"
        className="inline-block text-sm text-neutral-600 hover:text-neutral-900 md:hidden"
      >
        ← Volver a Grupos
      </Link>
      <PageHeader
        title={group.name}
        description={
          group.description ??
          (group.isPreset ? 'Grupo preset auto-generado. No se puede eliminar.' : '')
        }
      />

      <GroupDetailView
        placeSlug={place.slug}
        group={group}
        categories={categoryOptions}
        members={members}
        availableMembers={availableMembers}
      />
    </div>
  )
}
