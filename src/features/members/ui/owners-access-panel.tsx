'use client'

import { useState, useTransition } from 'react'
import { Mail, Trash2 } from 'lucide-react'
import { MemberAvatar } from './member-avatar'
import { InviteOwnerSheet } from '@/features/members/invitations/public'
import {
  resendInvitationAction,
  revokeInvitationAction,
} from '@/features/members/invitations/public'
import { TransferOwnershipSheet } from '@/features/places/public'
import { RowActions } from '@/shared/ui/row-actions'
import { toast } from '@/shared/ui/toaster'
import { isDomainError } from '@/shared/errors/domain-error'
import type { PendingInvitation } from '../domain/types'

/**
 * Orquestador del panel de acceso del place.
 *
 * Estructura: una sección **"Owners"** que combina owners activos +
 * invitaciones pendientes con `asOwner=true` en una única lista con chips
 * (`activo` / `pendiente`). Cada pending invite tiene `<RowActions>` con
 * [Reenviar, Revocar (destructive)]. Action buttons globales abren overlays:
 * - "+ Invitar owner" → `<InviteOwnerSheet>` (force `asOwner=true`).
 * - "Transferir ownership" (solo owners) → `<TransferOwnershipSheet>`.
 *
 * **Cambios 2026-05-12 (sesión 2 del rediseño access):**
 * - Sección "Salir del place" MOVIDA a `/settings/danger-zone` (renombre
 *   2026-05-14 de `/settings/system`, ADR
 *   `docs/decisions/2026-05-12-settings-system-for-lifecycle.md`).
 * - `<ResendInvitationButton>` inline reemplazado por `<RowActions>`
 *   canónico con [Reenviar, Revocar destructive]. Confirm dialog
 *   automático al revocar.
 * - Locale del formatDate: `'es-AR'` → `undefined` (viewer locale).
 *
 * Decisión histórica 2026-05-03: `/settings/access` es exclusivamente sobre
 * ownership. Member/admin invites se moverán a `/settings/members` en un flow
 * futuro; acá ya no se exponen.
 *
 * Client Component porque mantiene state para los 2 overlays. El page padre
 * sigue siendo Server Component que carga data y se la pasa por props.
 */

type OwnerActive = {
  userId: string
  membershipId: string
  displayName: string
  handle: string | null
  avatarUrl: string | null
  joinedAt: Date
}

type OwnerCandidate = {
  userId: string
  displayName: string
  handle: string | null
}

type Props = {
  placeSlug: string
  isOwner: boolean
  /** Owners activos del place (members con `isOwner=true`). */
  activeOwners: OwnerActive[]
  /** Invitaciones pendientes con `asOwner=true` (filtradas en el page). */
  pendingOwnerInvites: PendingInvitation[]
  /** Candidatos para transferir ownership (members activos ≠ actor). Vacío
   *  cuando el viewer no es owner — el botón Transferir tampoco se renderiza. */
  transferCandidates: OwnerCandidate[]
}

type SheetState = { kind: 'closed' } | { kind: 'invite' } | { kind: 'transfer' }

export function OwnersAccessPanel({
  placeSlug,
  isOwner,
  activeOwners,
  pendingOwnerInvites,
  transferCandidates,
}: Props): React.ReactNode {
  const [sheet, setSheet] = useState<SheetState>({ kind: 'closed' })

  function close(): void {
    setSheet({ kind: 'closed' })
  }

  const totalActive = activeOwners.length
  const totalPending = pendingOwnerInvites.length

  return (
    <>
      <section aria-labelledby="access-owners-heading" className="space-y-3">
        <div>
          <h2
            id="access-owners-heading"
            className="border-b pb-2 font-serif text-xl"
            style={{ borderColor: 'var(--border)' }}
          >
            Owners
          </h2>
          <p className="mt-1 text-xs text-neutral-600">
            {totalActive} {totalActive === 1 ? 'activo' : 'activos'}
            {totalPending > 0 ? (
              <>
                {' '}
                · {totalPending} {totalPending === 1 ? 'pendiente' : 'pendientes'}
              </>
            ) : null}
            . El owner administra todo el place y puede invitar otros owners.
          </p>
        </div>

        {isOwner ? (
          <button
            type="button"
            onClick={() => setSheet({ kind: 'invite' })}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 px-4 text-sm font-medium text-neutral-600 hover:border-neutral-500"
          >
            <span aria-hidden="true">+</span> Invitar owner
          </button>
        ) : null}

        {totalActive === 0 && totalPending === 0 ? (
          <p className="text-sm italic text-neutral-500">
            Este place todavía no tiene owners. (No debería pasar — verificá la consola.)
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
            {activeOwners.map((o) => (
              <li
                key={o.membershipId}
                className="flex min-h-[56px] items-center gap-3 py-2 text-sm"
              >
                <MemberAvatar
                  userId={o.userId}
                  displayName={o.displayName}
                  avatarUrl={o.avatarUrl}
                  size={32}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{o.displayName}</div>
                  {o.handle ? (
                    <div className="truncate text-xs text-neutral-600">@{o.handle}</div>
                  ) : null}
                </div>
                <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600">
                  activo
                </span>
              </li>
            ))}

            {pendingOwnerInvites.map((inv) => (
              <PendingInviteRow key={inv.id} invitation={inv} />
            ))}
          </ul>
        )}
      </section>

      {isOwner ? (
        <section aria-labelledby="access-transfer-heading" className="space-y-3">
          <div>
            <h2
              id="access-transfer-heading"
              className="border-b pb-2 font-serif text-xl"
              style={{ borderColor: 'var(--border)' }}
            >
              Transferir ownership
            </h2>
            <p className="mt-1 text-sm text-neutral-600">
              Cedé ownership a otro miembro. Si lo dejás sin la opción de salir, quedás co-owner.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSheet({ kind: 'transfer' })}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-md border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-50"
          >
            Transferir ownership
          </button>
        </section>
      ) : null}

      <InviteOwnerSheet
        open={sheet.kind === 'invite'}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        placeSlug={placeSlug}
      />

      <TransferOwnershipSheet
        open={sheet.kind === 'transfer'}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        placeSlug={placeSlug}
        candidates={transferCandidates}
      />
    </>
  )
}

/**
 * Row de invitación pendiente con `<RowActions>` para [Reenviar, Revocar].
 * Aislado en sub-component para tener `useTransition` propio por row (el
 * pending state de UN reenvío no bloquea otros).
 *
 * Feedback de las acciones: toast (sonner) — alineado con el patrón canónico
 * `ux-patterns.md` § "Toast over inline banner". El previo
 * `<ResendInvitationButton>` mostraba feedback inline en el row; ese widget
 * sigue exportado para otros consumers (e.g. `<PendingInvitationsList>` que
 * todavía lo usa), pero acá usamos toast.
 */
function PendingInviteRow({ invitation }: { invitation: PendingInvitation }): React.ReactNode {
  const [, startTransition] = useTransition()

  function handleResend(): void {
    startTransition(async () => {
      try {
        await resendInvitationAction({ invitationId: invitation.id })
        toast.success('Invitación reenviada.')
      } catch (err) {
        toast.error(friendlyMessage(err))
      }
    })
  }

  function handleRevoke(): void {
    startTransition(async () => {
      try {
        await revokeInvitationAction({ invitationId: invitation.id })
        toast.success('Invitación revocada.')
      } catch (err) {
        toast.error(friendlyMessage(err))
      }
    })
  }

  return (
    <li className="flex min-h-[56px] items-center gap-3 py-2 text-sm">
      <div
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs text-neutral-500"
      >
        {invitation.email.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{invitation.email}</div>
        <div className="truncate text-xs text-neutral-600">
          Invitado por {invitation.inviter.displayName} · vence {formatDate(invitation.expiresAt)}
        </div>
      </div>
      <RowActions
        triggerLabel={`Acciones para invitación a ${invitation.email}`}
        chipClassName="rounded-full border border-amber-300 px-2 py-0.5 text-[11px] text-amber-700"
        actions={[
          {
            icon: <Mail className="h-4 w-4" aria-hidden="true" />,
            label: 'Reenviar',
            onSelect: handleResend,
          },
          {
            icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
            label: 'Revocar',
            onSelect: handleRevoke,
            destructive: true,
            confirmTitle: `¿Revocar invitación a ${invitation.email}?`,
            confirmDescription: 'El link enviado dejará de funcionar. El receptor no podrá usarlo.',
            confirmActionLabel: 'Sí, revocar',
          },
        ]}
      >
        pendiente
      </RowActions>
    </li>
  )
}

function friendlyMessage(err: unknown): string {
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
      default:
        return 'La acción falló.'
    }
  }
  return 'Error inesperado.'
}

/**
 * Formato corto de fecha. `undefined` locale = viewer's browser locale
 * (anchor principle #6 del `ux-patterns.md`). El previo hardcodeaba
 * `'es-AR'` — corregido en sesión 2.
 */
function formatDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(d)
}
