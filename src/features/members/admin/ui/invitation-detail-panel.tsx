'use client'

import { Send, X } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import {
  EditPanel,
  EditPanelBody,
  EditPanelContent,
  EditPanelFooter,
  EditPanelHeader,
  EditPanelTitle,
} from '@/shared/ui/edit-panel'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog'
import { toast } from '@/shared/ui/toaster'
import {
  resendInvitationAction,
  revokeInvitationAction,
} from '@/features/members/invitations/public'
import type { PendingInvitation, InvitationDeliveryStatus } from '@/features/members/public'
import { friendlyInvitationError } from '../lib/friendly-invitation-error'

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  invitation: PendingInvitation | null
  /** Permission del viewer para revocar — gatea el botón "Cancelar". */
  canRevoke: boolean
  /** Callback post-revoke success — orchestrator cierra el panel. */
  onRevoked: () => void
}

/**
 * Panel de detalle (read-only) de una invitación pendiente.
 *
 * Mirror del `<MemberDetailPanel>` / `<GroupDetailPanel>`. Información:
 * email, delivery status con explicación, invited by, sent at, expires at.
 *
 * Footer:
 *  - "Reenviar" filled primary: dispara `resendInvitationAction`. Toast con
 *    resultado. NO cierra el panel (operación no destructiva).
 *  - "Cancelar invitación" destructive: abre `<Dialog>` confirm. Si el user
 *    confirma, dispara `revokeInvitationAction` + cierra el panel via
 *    `onRevoked` (que el orchestrator setea a `{kind: 'closed'}`).
 *
 * Latch interno: preserva último `invitation` non-null para Radix Presence.
 */
export function InvitationDetailPanel({
  open,
  onOpenChange,
  invitation,
  canRevoke,
  onRevoked,
}: Props): React.ReactNode {
  const [latched, setLatched] = useState<PendingInvitation | null>(null)
  useEffect(() => {
    if (invitation) setLatched(invitation)
  }, [invitation])

  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [pendingResend, startResend] = useTransition()
  const [pendingRevoke, startRevoke] = useTransition()

  const displayInv = invitation ?? latched ?? null
  if (!displayInv) return null

  const meta = STATUS_META[displayInv.deliveryStatus]

  function handleResend(): void {
    if (!displayInv || pendingResend) return
    startResend(async () => {
      try {
        await resendInvitationAction({ invitationId: displayInv.id })
        toast.success(`Invitación reenviada a ${displayInv.email}.`)
      } catch (err) {
        toast.error(friendlyInvitationError(err))
      }
    })
  }

  function handleConfirmRevoke(): void {
    if (!displayInv || pendingRevoke) return
    startRevoke(async () => {
      try {
        await revokeInvitationAction({ invitationId: displayInv.id })
        toast.success(`Invitación a ${displayInv.email} cancelada.`)
        setConfirmRevoke(false)
        onRevoked()
      } catch (err) {
        toast.error(friendlyInvitationError(err))
        setConfirmRevoke(false)
      }
    })
  }

  return (
    <>
      <EditPanel open={open} onOpenChange={onOpenChange}>
        <EditPanelContent aria-describedby={undefined}>
          <EditPanelHeader>
            <EditPanelTitle>
              <span className="flex items-center gap-2">
                <span className="truncate">{displayInv.email}</span>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${meta.className}`}
                  title={meta.help}
                >
                  {meta.label}
                </span>
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
                  Invitación
                </h3>
                <p className="text-sm text-neutral-700">
                  Invitado por <span className="font-medium">{displayInv.inviter.displayName}</span>
                </p>
                {displayInv.asOwner ? (
                  <p className="text-sm text-neutral-700">
                    Rol al aceptar: <span className="font-medium">owner</span>.
                  </p>
                ) : displayInv.asAdmin ? (
                  <p className="text-sm text-neutral-700">
                    Rol al aceptar: <span className="font-medium">admin</span>.
                  </p>
                ) : (
                  <p className="text-sm text-neutral-700">Rol al aceptar: miembro.</p>
                )}
                {displayInv.lastSentAt ? (
                  <p className="text-sm text-neutral-700">
                    Último envío: {formatDateTime(displayInv.lastSentAt)}.
                  </p>
                ) : null}
                <p className="text-sm text-neutral-700">
                  Vence el {formatDate(displayInv.expiresAt)}.
                </p>
              </section>

              <section className="space-y-2">
                <h3
                  className="border-b pb-2 font-serif text-base"
                  style={{ borderColor: 'var(--border)' }}
                >
                  Estado de entrega
                </h3>
                <p className="text-sm text-neutral-700">{meta.help}</p>
                {displayInv.lastDeliveryError ? (
                  <p className="text-xs italic text-amber-700">{displayInv.lastDeliveryError}</p>
                ) : null}
              </section>
            </div>
          </EditPanelBody>

          <EditPanelFooter>
            <button
              type="button"
              onClick={handleResend}
              disabled={pendingResend}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-60"
            >
              <Send aria-hidden="true" className="h-4 w-4" />
              {pendingResend ? 'Reenviando…' : 'Reenviar invitación'}
            </button>
            {canRevoke ? (
              <button
                type="button"
                onClick={() => setConfirmRevoke(true)}
                disabled={pendingRevoke}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
              >
                <X aria-hidden="true" className="h-4 w-4" />
                Cancelar invitación
              </button>
            ) : null}
          </EditPanelFooter>
        </EditPanelContent>
      </EditPanel>

      <Dialog
        open={confirmRevoke}
        onOpenChange={(next) => {
          if (!next) setConfirmRevoke(false)
        }}
      >
        <DialogContent>
          <DialogTitle>{`¿Cancelar invitación a ${displayInv.email}?`}</DialogTitle>
          <DialogDescription>
            La invitación queda invalidada. El email no podrá usar el link recibido. Si querés
            volver a invitar, mandá una nueva invitación.
          </DialogDescription>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setConfirmRevoke(false)}
              disabled={pendingRevoke}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-300 px-4 text-sm disabled:opacity-60"
            >
              Volver
            </button>
            <button
              type="button"
              onClick={handleConfirmRevoke}
              disabled={pendingRevoke}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-red-600 bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {pendingRevoke ? 'Cancelando…' : 'Sí, cancelar'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

const STATUS_META: Record<
  InvitationDeliveryStatus,
  { label: string; className: string; help: string }
> = {
  PENDING: {
    label: 'pendiente',
    className: 'border-neutral-300 text-neutral-600',
    help: 'Esperando envío al proveedor de email.',
  },
  SENT: {
    label: 'enviado',
    className: 'border-neutral-300 text-neutral-700',
    help: 'Email entregado al proveedor.',
  },
  DELIVERED: {
    label: 'entregado',
    className: 'border-emerald-300 text-emerald-700',
    help: 'El proveedor confirmó entrega al servidor del destinatario.',
  },
  BOUNCED: {
    label: 'rebotado',
    className: 'border-amber-300 text-amber-700',
    help: 'El servidor del destinatario rechazó el email. Verificá la dirección y reenviá.',
  },
  COMPLAINED: {
    label: 'spam',
    className: 'border-amber-300 text-amber-700',
    help: 'El destinatario marcó el email como spam.',
  },
  FAILED: {
    label: 'falló',
    className: 'border-amber-300 text-amber-700',
    help: 'No se pudo enviar. Reenviá para reintentar.',
  },
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d)
}

function formatDateTime(d: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}
