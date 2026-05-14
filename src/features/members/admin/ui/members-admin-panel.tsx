'use client'

import { useState, useTransition } from 'react'
import { toast } from '@/shared/ui/toaster'
import { isDomainError } from '@/shared/errors/domain-error'
import {
  resendInvitationAction,
  revokeInvitationAction,
} from '@/features/members/invitations/public'
import type {
  MemberDirectoryPage,
  MemberSummary,
  PendingInvitationsPage,
} from '@/features/members/public.server'
import type { PendingInvitation } from '@/features/members/public'
import { InvitationDetailPanel } from './invitation-detail-panel'
import { InvitationRow } from './invitation-row'
import { InviteMemberSheet } from './invite-member-sheet'
import { MemberDetailPanel, type MemberDetailBlockInfo } from './member-detail-panel'
import { MemberRow } from './member-row'
import { MembersPagination } from './members-pagination'

type Tab = 'active' | 'pending'

type Props = {
  placeSlug: string
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
  /** Builder de URL para paginación + tab switching. Recibe overrides parciales. */
  buildHref: (next: { tab?: Tab; q?: string; page?: number }) => string
}

type SheetState =
  | { kind: 'closed' }
  | { kind: 'invite' }
  | { kind: 'detail-member'; userId: string }
  | { kind: 'detail-invitation'; invitationId: string }

/**
 * Orquestador admin de `/settings/members` (rediseño 2026-05-14).
 *
 * **Patrón canónico `detail-from-list`** (mirror exacto de `<GroupsAdminPanel>`):
 *  - Row entera tappable → abre detail panel (EditPanel).
 *  - Kebab forceOverflow ofrece atajos directos (Expulsar/Bloquear para
 *    miembros; Reenviar/Cancelar para invitaciones).
 *  - Dashed-border "+ Invitar miembro" al final del listado (sesión 3 conecta
 *    al `<InviteMemberSheet>`).
 *
 * **Tabs Activos / Invitados**: chips con counter. Mutuamente excluyentes
 * (URL `?tab=`). Search bar único — aplica a displayName+handle en Activos,
 * a email en Invitados.
 *
 * **Sesión 2 scope**: state machine completa, listados y detail panel de
 * miembros. Sub-sheets (invitar, detalle invitación, gestionar tiers/grupos)
 * llegan en sesión 3 — por eso `onManageTiers/onManageGroups` se pasan como
 * `null` y los handlers de `invite` y `detail-invitation` están stubeados.
 *
 * **Latch interno** para detail panels (Radix Presence exit anim).
 */
export function MembersAdminPanel({
  placeSlug,
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
  buildHref,
}: Props): React.ReactNode {
  const [sheet, setSheet] = useState<SheetState>({ kind: 'closed' })

  function close(): void {
    setSheet({ kind: 'closed' })
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
        canExpel={detailMember ? canExpelTarget(detailMember) : false}
        canBlock={detailMember ? canBlockTarget(detailMember) : false}
        canUnblock={detailMember ? canUnblock && blockInfoByUserId.has(detailMember.userId) : false}
        onExpel={() => {
          // S3 wiring — abre ExpelMemberDialog
        }}
        onBlock={() => {
          // S3 wiring — abre BlockMemberDialog
        }}
        onUnblock={() => {
          // S3 wiring — abre confirm + unblockMemberAction
        }}
        onManageTiers={null}
        onManageGroups={null}
      />

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

function friendlyInvitationError(err: unknown): string {
  if (isDomainError(err)) {
    switch (err.code) {
      case 'AUTHORIZATION':
        return 'No tenés permisos.'
      case 'NOT_FOUND':
        return 'La invitación ya no existe.'
      case 'CONFLICT':
        return err.message
      case 'VALIDATION':
        return err.message
      case 'INVITATION_LINK_GENERATION':
        return 'No pudimos generar el link. Intentá de nuevo.'
      case 'INVITATION_EMAIL_FAILED':
        return 'No pudimos enviar el email. Intentá de nuevo.'
      default:
        return 'No se pudo completar la acción.'
    }
  }
  return 'Error inesperado.'
}

function TabChip({
  href,
  active,
  label,
  count,
}: {
  href: string
  active: boolean
  label: string
  count: number | null
}): React.ReactNode {
  const base =
    'inline-flex min-h-11 items-center rounded-full border px-3 text-sm transition-colors'
  const activeClass = 'border-neutral-900 bg-neutral-900 text-white'
  const inactiveClass = 'border-neutral-300 text-neutral-700 hover:bg-neutral-50'
  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`${base} ${active ? activeClass : inactiveClass}`}
    >
      <span>{label}</span>
      {count !== null ? (
        <span
          className={`ml-1.5 inline-block min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] ${
            active ? 'bg-white/15' : 'bg-neutral-100'
          }`}
        >
          {count}
        </span>
      ) : null}
    </a>
  )
}
