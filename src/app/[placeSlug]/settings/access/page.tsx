import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCurrentAuthUser } from '@/shared/lib/auth-user'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { PageHeader } from '@/shared/ui/page-header'
import { OwnersAccessPanel } from '@/features/members/access/public'
import {
  findMemberPermissions,
  listActiveMembers,
  listPendingInvitationsByPlace,
} from '@/features/members/public.server'

export const metadata: Metadata = {
  title: 'Acceso · Settings',
}

type Props = { params: Promise<{ placeSlug: string }> }

/**
 * Panel de **Acceso** del place — exclusivamente sobre **ownership**.
 *
 * Decisión 2026-05-03 (rediseño post UX patterns canónicos):
 * `/settings/access` se enfoca en una sola cosa: quiénes son owners. La
 * página combina owners activos + invitaciones pendientes con `asOwner=true`
 * en una sola lista con chips, y expone tres acciones como overlays
 * (BottomSheets / Dialog modal):
 *  - Invitar owner (owner-only)
 *  - Transferir ownership (owner-only)
 *  - Salir del place (cualquier miembro)
 *
 * Member/admin invites NO viven más acá: futuros flows los expondrán desde
 * `/settings/members` (directorio owner-only). El renombre histórico
 * `/settings/members → /settings/access` (M.4) cierra acá: el page sólo
 * habla de access (ownership), y el directorio sigue en `/settings/members`.
 *
 * El gate admin/owner vive en `settings/layout.tsx` — acá asumimos auth
 * válida. El orquestador `<OwnersAccessPanel>` es Client Component;
 * la page sólo carga datos + compone.
 */
export default async function SettingsAccessPage({ params }: Props) {
  const { placeSlug } = await params

  const auth = await getCurrentAuthUser()
  const actorId = auth!.id

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) {
    notFound()
  }

  const [perms, members, pendingPage] = await Promise.all([
    findMemberPermissions(actorId, place.id),
    listActiveMembers(place.id),
    // Sin params → trae primera page con cap default. Para `/settings/access`
    // alcanza con la primera page de invitaciones owner (raro tener > 20
    // owners pendientes simultáneos en un place con 150 miembros cap).
    listPendingInvitationsByPlace(place.id),
  ])
  const pendingAll = pendingPage.rows

  const activeOwners = members
    .filter((m) => m.isOwner)
    .map((m) => ({
      userId: m.userId,
      membershipId: m.membershipId,
      displayName: m.user.displayName,
      handle: m.user.handle,
      avatarUrl: m.user.avatarUrl,
      joinedAt: m.joinedAt,
    }))

  const pendingOwnerInvites = pendingAll.filter((inv) => inv.asOwner)

  const transferCandidates = perms.isOwner
    ? members
        .filter((m) => m.userId !== actorId)
        .map((m) => ({
          userId: m.userId,
          displayName: m.user.displayName,
          handle: m.user.handle,
        }))
    : []

  return (
    <div className="mx-auto max-w-screen-md space-y-6 px-3 py-6 md:px-4 md:py-8">
      <PageHeader
        title="Acceso"
        description="Owners activos y pendientes, transferencia de ownership."
      />

      <OwnersAccessPanel
        placeSlug={place.slug}
        isOwner={perms.isOwner}
        activeOwners={activeOwners}
        pendingOwnerInvites={pendingOwnerInvites}
        transferCandidates={transferCandidates}
      />
    </div>
  )
}
