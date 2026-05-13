import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getCurrentAuthUser } from '@/shared/lib/auth-user'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { findMemberPermissions, listActiveMembers } from '@/features/members/public.server'
import { listGroupsByPlace, listMembershipsByGroupIds } from '@/features/groups/public.server'
import { ADMIN_PRESET_NAME, GroupsAdminPanel } from '@/features/groups/public'
import { PageHeader } from '@/shared/ui/page-header'

export const metadata: Metadata = {
  title: 'Grupos · Settings',
}

type Props = { params: Promise<{ placeSlug: string }> }

/**
 * Admin de grupos de permisos (S7, 2026-05-13).
 *
 * **Patrón canónico EditPanel + lista plana** — `detail-from-list`
 * (`docs/ux-patterns.md`). Mirror exacto del `/settings/library` admin:
 *  - PageHeader (título + descripción).
 *  - Section "Grupos" con lista plana + tap-to-detail + kebab forzado.
 *  - "+ Nuevo grupo" dashed-border abajo del listado.
 *
 * Tap-row → `<GroupDetailPanel>` (sidebar desktop / bottomsheet mobile)
 * con permisos + miembros + acciones (Editar / Eliminar / Gestionar
 * miembros). Reemplaza al master-detail anterior con page detail full
 * (drop de S7).
 *
 * Gate: owner-only. El layout `/settings/layout.tsx` ya gateá admin/owner;
 * acá afinamos a owner — grupos son owner-only (admin no califica).
 *
 * Data loading en paralelo:
 *  - `listGroupsByPlace` — grupos del place.
 *  - `listMembershipsByGroupIds(groupIds)` — Map<groupId, members[]>
 *    para precargar miembros y abrir detail instant sin extra fetch.
 *  - `listActiveMembers` — candidates para members sheet (excluye owner).
 */
export default async function SettingsGroupsPage({ params }: Props) {
  const { placeSlug } = await params

  const auth = await getCurrentAuthUser()
  if (!auth) {
    redirect(`/login?next=/settings/groups`)
  }

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) {
    notFound()
  }

  const perms = await findMemberPermissions(auth.id, place.id)
  if (!perms.isOwner) {
    notFound()
  }

  const groups = await listGroupsByPlace(place.id)
  const groupIds = groups.map((g) => g.id)
  const [membershipsByGroupId, activeMembers] = await Promise.all([
    listMembershipsByGroupIds(groupIds),
    listActiveMembers(place.id),
  ])

  const activeNonOwnerMembers = activeMembers
    .filter((m) => !m.isOwner)
    .map((m) => ({
      userId: m.userId,
      displayName: m.user.displayName,
      handle: m.user.handle,
      avatarUrl: m.user.avatarUrl,
    }))

  return (
    <div className="mx-auto max-w-screen-md space-y-6 px-3 py-6 md:px-4 md:py-8">
      <PageHeader
        title="Grupos"
        description={
          <>
            Definí grupos con permisos atómicos para delegar moderación. El grupo “
            {ADMIN_PRESET_NAME}” tiene todos los permisos por defecto y no se puede eliminar.
          </>
        }
      />

      <GroupsAdminPanel
        placeSlug={place.slug}
        groups={groups}
        membershipsByGroupId={membershipsByGroupId}
        activeMembers={activeNonOwnerMembers}
      />
    </div>
  )
}
