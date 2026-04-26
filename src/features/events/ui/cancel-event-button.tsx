'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cancelEventAction } from '../server/actions/cancel'
import { friendlyEventErrorMessage } from './errors'

/**
 * Botón "Cancelar evento" con confirmación inline. Tras confirmar, llama
 * `cancelEventAction` (soft-cancel — preserva RSVPs y Post asociado) y
 * refresca el thread (donde vive el header del evento, F.F).
 *
 * Sólo se renderiza para author/admin (gate en `EventMetadataHeader`). El
 * server re-valida permisos.
 */
export function CancelEventButton({ eventId }: { eventId: string }): React.ReactNode {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function cancel(): void {
    setError(null)
    startTransition(async () => {
      try {
        await cancelEventAction({ eventId })
        setConfirming(false)
        router.refresh()
      } catch (err) {
        setError(friendlyEventErrorMessage(err))
      }
    })
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-place-divider px-3 py-1.5 text-place-text-soft hover:border-amber-300 hover:text-amber-700"
      >
        Cancelar evento
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-place-text-soft">¿Seguro? La conversación queda viva.</span>
      <button
        type="button"
        onClick={cancel}
        disabled={pending}
        className="rounded-md bg-amber-100 px-3 py-1.5 text-amber-900 hover:bg-amber-200 disabled:opacity-60"
      >
        {pending ? 'Cancelando…' : 'Sí, cancelar'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="text-place-text-soft hover:text-place-text"
      >
        Volver
      </button>
      {error ? (
        <span role="alert" className="text-amber-700">
          {error}
        </span>
      ) : null}
    </span>
  )
}
