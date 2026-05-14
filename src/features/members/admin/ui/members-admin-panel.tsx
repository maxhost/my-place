'use client'

import { useState, useTransition } from 'react'
import { toast } from '@/shared/ui/toaster'
import {
  resendInvitationAction,
  revokeInvitationAction,
} from '@/features/members/invitations/public'
import { friendlyInvitationError } from '../lib/friendly-invitation-error'
import { useSubsheetTargets } from '../lib/use-subsheet-targets'
import type {
  MemberDirectoryPage,
  MemberSummary,
  PendingInvitationsPage,
} from '@/features/members/public.server'
import type { PendingInvitation } from '@/features/members/public'
import type { GroupSummary } from '@/features/groups/public'
import type { Tier } from '@/features/tiers/public'
import type { TierMembershipDetail } from '@/features/tier-memberships/public'
import { InvitationDetailPanel } from './invitation-detail-panel'
import { InvitationRow } from './invitation-row'
import { InviteMemberSheet } from './invite-member-sheet'
import { MemberDetailPanel, type MemberDetailBlockInfo } from './member-detail-panel'
import { MemberGroupsSheet } from './member-groups-sheet'
import { MemberRow } from './member-row'
import { MemberTiersSheet } from './member-tiers-sheet'
import { MembersPagination } from './members-pagination'
import { TabChip } from './tab-chip'

type Tab = 'active' | 'pending'

type Props = {
  placeSlug: string
  placeId: string
  /** Email del viewer — autocompleta el campo `contactEmail` en los dialogs de moderación. */
  actorEmail: string
  tab: Tab
  q: string
  page: number
  pageSize: number
  membersPage: MemberDirectoryPage
  invitationsPage: PendingInvitationsPage
  /** Map userId → blockInfo. Solo populated para members que están bloqueados. */
  blockInfoByUserId: ReadonlyMap<string, MemberDetailBlockInfo>
  viewerUserId: string
  canBlock: boolean
  canUnblock: boolean
  canExpel: boolean
  canRevoke: boolean
  /** Owner-only puede invitar como admin (decisión #2 ADR groups). */
  canInviteAsAdmin: boolean
  /** Tier memberships del miembro actualmente abierto en el detail. Map por userId. */
  tierMembershipsByUserId: ReadonlyMap<string, ReadonlyArray<TierMembershipDetail>>
  /** Grupos del miembro actualmente abierto en el detail. Map por userId. */
  groupsByUserId: ReadonlyMap<string, ReadonlyArray<GroupSummary>>
  /** Tiers PUBLISHED del place — opciones para asignar. */
  publishedTiers: ReadonlyArray<Tier>
  /** Todos los grupos del place — usados para derivar `availableGroups` por miembro. */
  allGroups: ReadonlyArray<GroupSummary>
  /** Builder de URL para paginación + tab switching. Recibe overrides parciales. */
  buildHref: (next: { tab?: Tab; q?: string; page?: number }) => string
}

type SheetState =
  | { kind: 'closed' }
  | { kind: 'invite' }
  | { kind: 'detail-member'; userId: string }
  | { kind: 'detail-invitation'; invitationId: string }
  | { kind: 'edit-tiers'; userId: string; returnTo: 'closed' | 'detail-member' }
  | { kind: 'edit-groups'; userId: string; returnTo: 'closed' | 'detail-member' }

/**
 * Orquestador admin de `/settings/members` — patrón canónico detail-from-list
 * (mirror de `<GroupsAdminPanel>`). Tabs Activos/Invitados URL-based, listados
 * con detail panel + kebab atajos. Sub-sheets de tiers/grupos abren desde el
 * detail (`returnTo: 'detail-member'`).
 */
export function MembersAdminPanel({
  placeSlug,
  placeId,
  actorEmail,
  tab,
  q,
  page,
  pageSize,
  membersPage,
  invitationsPage,
  blockInfoByUserId,
  viewerUserId,
  canBlock,
  canUnblock,
  canExpel,
  canRevoke,
  canInviteAsAdmin,
  tierMembershipsByUserId,
  groupsByUserId,
  publishedTiers,
  allGroups,
  buildHref,
}: Props): React.ReactNode {
  const [sheet, setSheet] = useState<SheetState>({ kind: 'closed' })

  function close(): void {
    setSheet((current) => {
      if (
        (current.kind === 'edit-tiers' || current.kind === 'edit-groups') &&
        current.returnTo === 'detail-member'
      ) {
        return { kind: 'detail-member', userId: current.userId }
      }
      return { kind: 'closed' }
    })
  }

  // Active state derivations.
  const detailMember: MemberSummary | null =
    sheet.kind === 'detail-member'
      ? (membersPage.rows.find((m) => m.userId === sheet.userId) ?? null)
      : null
  const detailInvitation: PendingInvitation | null =
    sheet.kind === 'detail-invitation'
      ? (invitationsPage.rows.find((inv) => inv.id === sheet.invitationId) ?? null)
      : null

  const detailBlockInfo = detailMember ? (blockInfoByUserId.get(detailMember.userId) ?? null) : null

  function canExpelTarget(m: MemberSummary): boolean {
    if (!canExpel) return false
    if (m.isOwner) return false
    if (m.userId === viewerUserId) return false
    return true
  }
  function canBlockTarget(m: MemberSummary): boolean {
    if (!canBlock) return false
    if (m.isOwner) return false
    if (m.userId === viewerUserId) return false
    if (blockInfoByUserId.has(m.userId)) return false
    return true
  }

  const [, startResend] = useTransition()
  const [, startRevoke] = useTransition()

  const { tiersSheetData, groupsSheetData } = useSubsheetTargets({
    activeSheet:
      sheet.kind === 'edit-tiers' || sheet.kind === 'edit-groups'
        ? { kind: sheet.kind, userId: sheet.userId }
        : null,
    members: membersPage.rows,
    tierMembershipsByUserId,
    groupsByUserId,
    allGroups,
  })

  function handleResendInvitation(inv: PendingInvitation): void {
    startResend(async () => {
      try {
        await resendInvitationAction({ invitationId: inv.id })
        toast.success(`Invitación reenviada a ${inv.email}.`)
      } catch (err) {
        toast.error(friendlyInvitationError(err))
      }
    })
  }

  function handleRevokeInvitation(inv: PendingInvitation): void {
    startRevoke(async () => {
      try {
        await revokeInvitationAction({ invitationId: inv.id })
        toast.success(`Invitación a ${inv.email} cancelada.`)
      } catch (err) {
        toast.error(friendlyInvitationError(err))
      }
    })
  }

  // URL builders para tabs y paginación.
  const activeTabHref = buildHref({ tab: 'active', page: 1 })
  const pendingTabHref = buildHref({ tab: 'pending', page: 1 })
  const prevHref = page > 1 ? buildHref({ page: page - 1 }) : null
  const currentPageData = tab === 'active' ? membersPage : invitationsPage
  const nextHref = currentPageData.hasMore ? buildHref({ page: page + 1 }) : null

  return (
    <section aria-labelledby="members-list-heading" className="space-y-3">
      <div>
        <h2
          id="members-list-heading"
          className="border-b pb-2 font-serif text-xl"
          style={{ borderColor: 'var(--border)' }}
        >
          {tab === 'active' ? 'Miembros' : 'Invitaciones pendientes'}
        </h2>
        <p className="mt-1 text-xs text-neutral-600">
          {tab === 'active'
            ? `${membersPage.totalCount} ${membersPage.totalCount === 1 ? 'miembro activo' : 'miembros activos'}.`
            : `${invitationsPage.totalCount} ${invitationsPage.totalCount === 1 ? 'invitación pendiente' : 'invitaciones pendientes'}.`}
          {q ? <span> Filtrando por “{q}”.</span> : null}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <TabChip
          href={activeTabHref}
          active={tab === 'active'}
          label="Activos"
          count={tab === 'active' ? membersPage.totalCount : null}
        />
        <TabChip
          href={pendingTabHref}
          active={tab === 'pending'}
          label="Invitados"
          count={tab === 'pending' ? invitationsPage.totalCount : null}
        />
      </div>

      {tab === 'active' ? (
        membersPage.rows.length === 0 ? (
          <p className="rounded-md border border-neutral-200 bg-neutral-50 p-6 text-sm italic text-neutral-500">
            {q ? 'Ningún miembro coincide con la búsqueda.' : 'Todavía no hay miembros activos.'}
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
            {membersPage.rows.map((m) => (
              <MemberRow
                key={m.userId}
                member={m}
                onSelect={() => setSheet({ kind: 'detail-member', userId: m.userId })}
                onExpel={
                  canExpelTarget(m)
                    ? () => setSheet({ kind: 'detail-member', userId: m.userId })
                    : null
                }
                onBlock={
                  canBlockTarget(m)
                    ? () => setSheet({ kind: 'detail-member', userId: m.userId })
                    : null
                }
              />
            ))}
          </ul>
        )
      ) : invitationsPage.rows.length === 0 ? (
        <p className="rounded-md border border-neutral-200 bg-neutral-50 p-6 text-sm italic text-neutral-500">
          {q ? 'Ninguna invitación coincide con la búsqueda.' : 'No hay invitaciones pendientes.'}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
          {invitationsPage.rows.map((inv) => (
            <InvitationRow
              key={inv.id}
              invitation={inv}
              onSelect={() => setSheet({ kind: 'detail-invitation', invitationId: inv.id })}
              onResend={() => handleResendInvitation(inv)}
              onRevoke={canRevoke ? () => handleRevokeInvitation(inv) : null}
            />
          ))}
        </ul>
      )}

      <MembersPagination
        page={page}
        totalCount={currentPageData.totalCount}
        pageSize={pageSize}
        prevHref={prevHref}
        nextHref={nextHref}
        itemLabel={
          tab === 'active'
            ? { singular: 'miembro', plural: 'miembros' }
            : { singular: 'invitación', plural: 'invitaciones' }
        }
      />

      <button
        type="button"
        onClick={() => setSheet({ kind: 'invite' })}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 px-4 text-sm font-medium text-neutral-600 hover:border-neutral-500"
      >
        <span aria-hidden="true">+</span> Invitar miembro
      </button>

      <MemberDetailPanel
        open={sheet.kind === 'detail-member'}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        member={detailMember}
        blockInfo={detailBlockInfo}
        placeId={placeId}
        actorEmail={actorEmail}
        canExpel={detailMember ? canExpelTarget(detailMember) : false}
        canBlock={detailMember ? canBlockTarget(detailMember) : false}
        canUnblock={detailMember ? canUnblock && blockInfoByUserId.has(detailMember.userId) : false}
        onManageTiers={
          detailMember
            ? () =>
                setSheet({
                  kind: 'edit-tiers',
                  userId: detailMember.userId,
                  returnTo: 'detail-member',
                })
            : null
        }
        onManageGroups={
          detailMember
            ? () =>
                setSheet({
                  kind: 'edit-groups',
                  userId: detailMember.userId,
                  returnTo: 'detail-member',
                })
            : null
        }
      />

      {tiersSheetData ? (
        <MemberTiersSheet
          open={sheet.kind === 'edit-tiers'}
          onOpenChange={(next) => {
            if (!next) close()
          }}
          placeSlug={placeSlug}
          memberUserId={tiersSheetData.userId}
          memberDisplayName={tiersSheetData.displayName}
          tierMemberships={tiersSheetData.tierMemberships}
          publishedTiers={publishedTiers}
        />
      ) : null}

      {groupsSheetData ? (
        <MemberGroupsSheet
          open={sheet.kind === 'edit-groups'}
          onOpenChange={(next) => {
            if (!next) close()
          }}
          placeId={placeId}
          memberUserId={groupsSheetData.userId}
          memberDisplayName={groupsSheetData.displayName}
          currentGroups={groupsSheetData.currentGroups}
          availableGroups={groupsSheetData.availableGroups}
        />
      ) : null}

      <InvitationDetailPanel
        open={sheet.kind === 'detail-invitation'}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        invitation={detailInvitation}
        canRevoke={canRevoke}
        onRevoked={close}
      />

      <InviteMemberSheet
        open={sheet.kind === 'invite'}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        placeSlug={placeSlug}
        canInviteAsAdmin={canInviteAsAdmin}
      />
    </section>
  )
}
