'use client'

import { useState, useTransition } from 'react'
import { resendInvitationAction } from '../server/actions'
import { isDomainError } from '@/shared/errors/domain-error'

/**
 * Botón "Reenviar" en cada row de `PendingInvitationsList`. Dispara
 * `resendInvitationAction`, que regenera el magic link y vuelve a enviar el
 * email. No rota el token — el link del email viejo sigue válido mientras la
 * invitación no venza (7 días).
 *
 * Estilo link neutro (no botón primario) — la sección de pendientes es
 * reconciliatoria, no queremos gritar "¡Reenviá!" junto a cada row.
 *
 * Usa `useTransition` + server action directo (no TanStack Query) para
 * alinear con el resto del slice y del proyecto (no hay `QueryClientProvider`
 * montado todavía — ver `discussions/ui/dwell-tracker.tsx`).
 */
export function ResendInvitationButton({ invitationId }: { invitationId: string }) {
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null)

  function onClick() {
    if (pending) return
    setFeedback(null)
    startTransition(async () => {
      try {
        await resendInvitationAction({ invitationId })
        setFeedback({ kind: 'ok', message: 'Reenviado.' })
      } catch (err) {
        setFeedback({ kind: 'err', message: friendlyMessage(err) })
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="text-xs text-neutral-700 underline underline-offset-2 hover:text-neutral-900 disabled:opacity-60"
      >
        {pending ? 'Enviando…' : 'Reenviar'}
      </button>
      {feedback ? (
        <span
          role={feedback.kind === 'ok' ? 'status' : 'alert'}
          className={feedback.kind === 'ok' ? 'text-xs text-emerald-700' : 'text-xs text-amber-700'}
        >
          {feedback.message}
        </span>
      ) : null}
    </div>
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
      case 'INVITATION_LINK_GENERATION':
        return 'No pudimos generar el link. Intentá de nuevo.'
      case 'INVITATION_EMAIL_FAILED':
        return 'No pudimos enviar el email. Intentá de nuevo.'
      default:
        return 'No se pudo reenviar.'
    }
  }
  return 'Error inesperado.'
}
