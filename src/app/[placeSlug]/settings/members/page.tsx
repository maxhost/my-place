import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCurrentAuthUser } from '@/shared/lib/auth-user'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { PageHeader } from '@/shared/ui/page-header'
import { MembersAdminPanel, MembersSearchBar } from '@/features/members/admin/public'
import {
  listBlockInfoForUsers,
  listGroupsForUsers,
  listTierMembershipsForUsers,
} from '@/features/members/admin/public.server'
import { DIRECTORY_LIMIT_DEFAULT, directoryQueryParamsSchema } from '@/features/members/public'
import {
  findMemberPermissions,
  hasPermission,
  listActiveMembers,
  listPendingInvitationsByPlace,
  searchMembers,
} from '@/features/members/public.server'
import { TransferOwnershipForm } from '@/features/places/public'
import { listGroupsByPlace } from '@/features/groups/public.server'
import { listTiersByPlace } from '@/features/tiers/public.server'

export const metadata: Metadata = {
  title: 'Miembros · Settings',
}

type Props = {
  params: Promise<{ placeSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * `/settings/members` — patrón canónico detail-from-list (rediseño 2026-05-14).
 *
 * Tabs Activos / Invitados con filter chip URL-based (`?tab=`). Search bar
 * que aplica a displayName+handle en Activos y a email en Invitados. Click
 * en una row abre el detail panel (EditPanel) con acciones de moderación,
 * tiers, grupos. Dashed-border "+ Invitar miembro" al final abre InviteMemberSheet.
 *
 * Drop sub-page `[userId]/page.tsx` — toda la info migra al detail panel.
 * Drop "Salir del place" — ya vive en /settings/system. "Transferir
 * ownership" se mantiene como sección al final (sin tocar).
 *
 * Ver `docs/plans/2026-05-14-redesign-settings-members.md`.
 */
export default async function SettingsMembersPage({ params, searchParams }: Props) {
  const { placeSlug } = await params
  const raw = await searchParams

  const auth = await getCurrentAuthUser()
  const actorId = auth!.id

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) {
    notFound()
  }

  const parsed = directoryQueryParamsSchema.safeParse({
    tab: raw.tab,
    q: raw.q,
    page: raw.page,
    limit: raw.limit,
  })
  const queryParams = parsed.success
    ? parsed.data
    : { tab: 'active' as const, q: '', page: 1, limit: DIRECTORY_LIMIT_DEFAULT }

  // Cargas comunes en paralelo (gate + page data + invitations + tiers + groups).
  const [perms, membersPage, invitationsPage, publishedTiers, allGroups, canBlock, canRevoke] =
    await Promise.all([
      findMemberPermissions(actorId, place.id),
      searchMembers(place.id, {
        q: queryParams.tab === 'active' ? queryParams.q : '',
        page: queryParams.page,
        limit: queryParams.limit,
      }),
      listPendingInvitationsByPlace(place.id, {
        q: queryParams.tab === 'pending' ? queryParams.q : '',
        page: queryParams.page,
        limit: queryParams.limit,
      }),
      listTiersByPlace(place.id, true).then((tiers) =>
        tiers.filter((t) => t.visibility === 'PUBLISHED'),
      ),
      listGroupsByPlace(place.id),
      hasPermission(actorId, place.id, 'members:block'),
      hasPermission(actorId, place.id, 'members:revoke-invitation'),
    ])
  // Expel es owner-only por decisión #8 ADR (no es delegable a un permission).
  const canExpel = perms.isOwner

  const visibleUserIds = membersPage.rows.map((m) => m.userId)
  const [tierMembershipsByUserId, groupsByUserId, blockInfoByUserId] = await Promise.all([
    listTierMembershipsForUsers(place.id, visibleUserIds),
    listGroupsForUsers(place.id, visibleUserIds),
    listBlockInfoForUsers(place.id, visibleUserIds),
  ])

  // TransferOwnership sigue requiriendo la lista completa de candidatos —
  // se mantiene la query independiente (sin paginar) sólo si el viewer es owner.
  const transferCandidates = perms.isOwner
    ? (await listActiveMembers(place.id))
        .filter((m) => m.userId !== actorId)
        .map((m) => ({
          userId: m.userId,
          displayName: m.user.displayName,
          handle: m.user.handle,
        }))
    : []

  const actorEmail = auth!.email ?? ''
  const totalMembers = membersPage.totalCount

  // Hrefs precomputados — no se pueden pasar funciones a Client Components.
  function buildHref(next: { tab?: 'active' | 'pending'; q?: string; page?: number }): string {
    const merged = {
      tab: next.tab ?? queryParams.tab,
      q: next.q ?? queryParams.q,
      page: next.page ?? 1,
    }
    const sp = new URLSearchParams()
    if (merged.tab !== 'active') sp.set('tab', merged.tab)
    if (merged.q) sp.set('q', merged.q)
    if (merged.page !== 1) sp.set('page', String(merged.page))
    const query = sp.toString()
    return query ? `/settings/members?${query}` : '/settings/members'
  }
  const currentHasMore =
    queryParams.tab === 'active' ? membersPage.hasMore : invitationsPage.hasMore
  const hrefs = {
    activeTab: buildHref({ tab: 'active', page: 1 }),
    pendingTab: buildHref({ tab: 'pending', page: 1 }),
    prevPage: queryParams.page > 1 ? buildHref({ page: queryParams.page - 1 }) : null,
    nextPage: currentHasMore ? buildHref({ page: queryParams.page + 1 }) : null,
  }

  return (
    <div className="mx-auto max-w-screen-md space-y-6 px-3 py-6 md:px-4 md:py-8">
      <PageHeader
        title="Miembros"
        description={`${totalMembers} ${totalMembers === 1 ? 'miembro activo' : 'miembros activos'} · ${invitationsPage.totalCount} ${invitationsPage.totalCount === 1 ? 'invitación pendiente' : 'invitaciones pendientes'}.`}
      />

      <MembersSearchBar tab={queryParams.tab} initialQ={queryParams.q} />

      <MembersAdminPanel
        placeSlug={place.slug}
        placeId={place.id}
        actorEmail={actorEmail}
        tab={queryParams.tab}
        q={queryParams.q}
        page={queryParams.page}
        pageSize={queryParams.limit}
        membersPage={membersPage}
        invitationsPage={invitationsPage}
        blockInfoByUserId={blockInfoByUserId}
        viewerUserId={actorId}
        canBlock={canBlock}
        canUnblock={canBlock}
        canExpel={canExpel}
        canRevoke={canRevoke}
        canInviteAsAdmin={perms.isOwner}
        tierMembershipsByUserId={tierMembershipsByUserId}
        groupsByUserId={groupsByUserId}
        publishedTiers={publishedTiers}
        allGroups={allGroups}
        hrefs={hrefs}
      />

      {perms.isOwner ? (
        <section
          aria-labelledby="transfer-ownership-heading"
          className="space-y-3 border-t border-neutral-200 pt-6"
        >
          <h2
            id="transfer-ownership-heading"
            className="border-b pb-2 font-serif text-xl"
            style={{ borderColor: 'var(--border)' }}
          >
            Transferir ownership
          </h2>
          <p className="text-sm text-neutral-600">
            El nuevo owner tiene que ser miembro activo de este place. Si te tildás la opción de
            salir, perdés acceso al place en el mismo paso.
          </p>
          <TransferOwnershipForm placeSlug={place.slug} candidates={transferCandidates} />
        </section>
      ) : null}
    </div>
  )
}
