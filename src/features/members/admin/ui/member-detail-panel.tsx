'use client'

import { Trash2, UserX, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  EditPanel,
  EditPanelBody,
  EditPanelContent,
  EditPanelFooter,
  EditPanelHeader,
  EditPanelTitle,
} from '@/shared/ui/edit-panel'
import { MemberAvatar } from '@/features/members/public'
import { BlockMemberDialog, ExpelMemberDialog } from '@/features/members/moderation/public'
import type { MemberSummary } from '@/features/members/public.server'

export type MemberDetailBlockInfo = {
  blockedAt: Date
  blockedReason: string | null
  blockedContactEmail: string | null
  blockedByDisplayName: string | null
}

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  /** Miembro a mostrar. `null` cuando el panel está cerrado y nunca se abrió. */
  member: MemberSummary | null
  /** Info de bloqueo del target. `null` ⇒ no bloqueado. */
  blockInfo: MemberDetailBlockInfo | null
  /** placeId requerido por los dialogs de moderación (block/expel/unblock). */
  placeId: string
  /** Email del actor — autocompleta el campo `contactEmail` de los dialogs. */
  actorEmail: string
  /** Si el viewer puede expulsar a este target (deriva permisos + target ≠ owner / self). */
  canExpel: boolean
  /** Si el viewer puede bloquear este target (permiso `members:block` + target ≠ owner / self). */
  canBlock: boolean
  /** Si el viewer puede desbloquear (típicamente mismo permission que block). */
  canUnblock: boolean
  onManageTiers: (() => void) | null
  onManageGroups: (() => void) | null
}

/**
 * Panel de detalle (read-only) de un miembro activo.
 *
 * Patrón canónico `detail-from-list` (mirror de `<GroupDetailPanel>` +
 * `<TierDetailPanel>`): EditPanel responsive — side drawer 520px desktop /
 * bottom sheet mobile. Read-only summary del miembro + acciones en el
 * footer (Bloquear / Expulsar / Desbloquear según estado + permisos).
 *
 * Sub-sheets "Gestionar tiers" y "Gestionar grupos" (S3) abren desde botones
 * inline en sus secciones. `onManageTiers / onManageGroups === null` ⇒ no
 * se muestra el botón (sesión 2 los deja apagados hasta que S3 implemente
 * los sheets).
 *
 * Latch interno: preserva el último `{member, blockInfo}` non-null para que
 * Radix Presence anime el exit del Content cuando `open` flipea a false.
 *
 * **Privacy**: NO se muestra email del miembro (decisión #6 spec members).
 * El email solo se expone para invitations pendientes (no es miembro aún).
 */
export function MemberDetailPanel({
  open,
  onOpenChange,
  member,
  blockInfo,
  placeId,
  actorEmail,
  canExpel,
  canBlock,
  canUnblock,
  onManageTiers,
  onManageGroups,
}: Props): React.ReactNode {
  const [latched, setLatched] = useState<{
    member: MemberSummary
    blockInfo: MemberDetailBlockInfo | null
  } | null>(null)
  useEffect(() => {
    if (member) setLatched({ member, blockInfo })
  }, [member, blockInfo])

  const displayMember = member ?? latched?.member ?? null
  const displayBlock = member ? blockInfo : (latched?.blockInfo ?? null)

  if (!displayMember) return null

  const handle = displayMember.user.handle ? `@${displayMember.user.handle}` : null
  const isBlocked = displayBlock !== null
  const joinedLabel = formatJoinedAt(displayMember.joinedAt)

  return (
    <EditPanel open={open} onOpenChange={onOpenChange}>
      <EditPanelContent aria-describedby={undefined}>
        <EditPanelHeader>
          <EditPanelTitle>
            <span className="flex items-center gap-3">
              <MemberAvatar
                userId={displayMember.userId}
                displayName={displayMember.user.displayName}
                avatarUrl={displayMember.user.avatarUrl}
                size={40}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{displayMember.user.displayName}</span>
                {handle ? (
                  <span className="block truncate text-sm font-normal text-neutral-500">
                    {handle}
                  </span>
                ) : null}
              </span>
              {displayMember.isOwner ? (
                <span className="shrink-0 rounded-full border border-amber-300 px-2 py-0.5 text-[11px] text-amber-700">
                  owner
                </span>
              ) : displayMember.isAdmin ? (
                <span className="shrink-0 rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600">
                  admin
                </span>
              ) : null}
            </span>
          </EditPanelTitle>
        </EditPanelHeader>

        <EditPanelBody>
          <div className="space-y-5 py-2">
            <section className="space-y-2">
              <h3
                className="border-b pb-2 font-serif text-base"
                style={{ borderColor: 'var(--border)' }}
              >
                Membresía
              </h3>
              <p className="text-sm text-neutral-700">Se unió {joinedLabel}.</p>
            </section>

            <section className="space-y-2">
              <div
                className="flex items-baseline justify-between gap-2 border-b pb-2"
                style={{ borderColor: 'var(--border)' }}
              >
                <h3 className="font-serif text-base">Tiers</h3>
                <span className="text-xs text-neutral-600">
                  {displayMember.tierCount} {displayMember.tierCount === 1 ? 'tier' : 'tiers'}
                </span>
              </div>
              {displayMember.tierCount === 0 ? (
                <p className="text-sm italic text-neutral-500">Sin tiers asignados.</p>
              ) : (
                <p className="text-sm text-neutral-700">
                  {displayMember.tierCount}{' '}
                  {displayMember.tierCount === 1 ? 'asignación activa' : 'asignaciones activas'}.
                </p>
              )}
              {onManageTiers ? (
                <button
                  type="button"
                  onClick={onManageTiers}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-50"
                >
                  Gestionar tiers
                </button>
              ) : null}
            </section>

            <section className="space-y-2">
              <h3
                className="border-b pb-2 font-serif text-base"
                style={{ borderColor: 'var(--border)' }}
              >
                Grupos
              </h3>
              <p className="text-sm text-neutral-700">
                {displayMember.isAdmin && !displayMember.isOwner
                  ? 'Pertenece al grupo Administradores.'
                  : 'Las asignaciones se gestionan desde el panel.'}
              </p>
              {onManageGroups ? (
                <button
                  type="button"
                  onClick={onManageGroups}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-50"
                >
                  Gestionar grupos
                </button>
              ) : null}
            </section>

            {isBlocked && displayBlock ? (
              <section className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck aria-hidden="true" className="h-4 w-4 text-amber-700" />
                  <h3 className="font-serif text-base text-amber-900">Bloqueado</h3>
                </div>
                <p className="text-sm text-amber-900">
                  Bloqueado el {formatDate(displayBlock.blockedAt)}
                  {displayBlock.blockedByDisplayName
                    ? ` por ${displayBlock.blockedByDisplayName}`
                    : ''}
                  .
                </p>
                {displayBlock.blockedReason ? (
                  <p className="text-sm text-amber-900">
                    <span className="font-medium">Motivo:</span> {displayBlock.blockedReason}
                  </p>
                ) : null}
                {displayBlock.blockedContactEmail ? (
                  <p className="text-xs text-amber-800">
                    Contacto: {displayBlock.blockedContactEmail}
                  </p>
                ) : null}
              </section>
            ) : null}
          </div>
        </EditPanelBody>

        <EditPanelFooter>
          {isBlocked && canUnblock ? (
            <BlockMemberDialog
              mode={{
                kind: 'unblock',
                placeId,
                memberUserId: displayMember.userId,
                memberDisplayName: displayMember.user.displayName,
                actorEmail,
              }}
              trigger={
                <button
                  type="button"
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 text-sm font-medium text-amber-900 hover:bg-amber-100"
                >
                  <ShieldCheck aria-hidden="true" className="h-4 w-4" />
                  Desbloquear
                </button>
              }
            />
          ) : null}
          {!isBlocked && canBlock ? (
            <BlockMemberDialog
              mode={{
                kind: 'block',
                placeId,
                memberUserId: displayMember.userId,
                memberDisplayName: displayMember.user.displayName,
                actorEmail,
              }}
              trigger={
                <button
                  type="button"
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  <UserX aria-hidden="true" className="h-4 w-4" />
                  Bloquear
                </button>
              }
            />
          ) : null}
          {canExpel ? (
            <ExpelMemberDialog
              placeId={placeId}
              memberUserId={displayMember.userId}
              memberDisplayName={displayMember.user.displayName}
              actorEmail={actorEmail}
              trigger={
                <button
                  type="button"
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                  Expulsar
                </button>
              }
            />
          ) : null}
          {!canExpel && !canBlock && !canUnblock ? (
            <p className="text-xs italic text-neutral-500">
              Sin acciones disponibles para este miembro.
            </p>
          ) : null}
        </EditPanelFooter>
      </EditPanelContent>
    </EditPanel>
  )
}

function formatJoinedAt(joinedAt: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(joinedAt)
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d)
}
