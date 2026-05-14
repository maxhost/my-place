import 'server-only'
import { listPendingInvitationsByPlace } from '@/features/members/server/queries'
import type { InvitationDeliveryStatus, PendingInvitation } from '@/features/members/domain/types'
import { ResendInvitationButton } from './resend-invitation-button'

/**
 * Server Component: lista invitaciones abiertas del place y renderiza cada
 * row con status + acción "Reenviar". Se monta en `/settings/members` entre
 * "Invitar" y "Transferir ownership".
 *
 * Sin contadores agresivos ni colores llamativos — status badges neutras y
 * el botón Reenviar es un link sutil. Ver principio "nada parpadea, nada
 * grita" en `CLAUDE.md`.
 */
export async function PendingInvitationsList({ placeId }: { placeId: string }) {
  const { rows: pending } = await listPendingInvitationsByPlace(placeId)

  if (pending.length === 0) {
    return <p className="text-sm text-neutral-500">No hay invitaciones pendientes.</p>
  }

  return (
    <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
      {pending.map((inv) => (
        <li key={inv.id} className="flex items-center justify-between gap-3 py-3 text-sm">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{inv.email}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <span>Invitado por {inv.inviter.displayName}</span>
              <span aria-hidden>·</span>
              <span>Vence {formatDate(inv.expiresAt)}</span>
              {inv.asAdmin ? (
                <>
                  <span aria-hidden>·</span>
                  <span>como admin</span>
                </>
              ) : null}
            </div>
            {inv.lastDeliveryError ? (
              <div className="mt-1 text-xs text-amber-700">{truncate(inv.lastDeliveryError)}</div>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-1">
            <DeliveryStatusBadge status={inv.deliveryStatus} />
            <ResendInvitationButton invitationId={inv.id} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function DeliveryStatusBadge({ status }: { status: InvitationDeliveryStatus }) {
  const meta = STATUS_META[status]
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] ${meta.className}`}
      title={meta.help}
    >
      {meta.label}
    </span>
  )
}

const STATUS_META: Record<
  PendingInvitation['deliveryStatus'],
  { label: string; className: string; help: string }
> = {
  PENDING: {
    label: 'pendiente',
    className: 'border-neutral-300 text-neutral-600',
    help: 'Esperando envío.',
  },
  SENT: {
    label: 'enviado',
    className: 'border-neutral-300 text-neutral-700',
    help: 'Email entregado al proveedor.',
  },
  DELIVERED: {
    label: 'entregado',
    className: 'border-emerald-300 text-emerald-700',
    help: 'El proveedor confirmó entrega.',
  },
  BOUNCED: {
    label: 'rebotado',
    className: 'border-amber-300 text-amber-700',
    help: 'El servidor del destinatario rechazó el email.',
  },
  COMPLAINED: {
    label: 'spam',
    className: 'border-amber-300 text-amber-700',
    help: 'El destinatario marcó como spam.',
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
  }).format(d)
}

function truncate(s: string, n = 120): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`
}
