'use client'

import { useState, useTransition } from 'react'
import { leaveMembershipAction } from '../server/actions'
import { isDomainError } from '@/shared/errors/domain-error'

/**
 * Botón de "salir del place". Requiere doble confirmación — click abre el prompt,
 * segundo click confirma la acción.
 *
 * Tras salir, navega al dashboard universal (`appUrl`), que vive en el apex — no tiene
 * sentido volver al place del que el user acaba de salir porque el middleware lo va a
 * rebotar (ya no es miembro).
 */
export function LeaveButton({ placeSlug, appUrl }: { placeSlug: string; appUrl: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  function onClick() {
    setError(null)
    if (!confirming) {
      setConfirming(true)
      return
    }
    startTransition(async () => {
      try {
        await leaveMembershipAction(placeSlug)
        window.location.href = `${appUrl}/inbox`
      } catch (err) {
        setConfirming(false)
        setError(friendlyMessage(err))
      }
    })
  }

  return (
    <div className="space-y-2">
      {error ? (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={
          confirming
            ? 'w-full rounded-md border border-red-400 bg-red-50 px-4 py-2 text-sm text-red-900 hover:bg-red-100 disabled:opacity-60'
            : 'w-full rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-60'
        }
      >
        {pending
          ? 'Saliendo…'
          : confirming
            ? 'Click otra vez para confirmar la salida'
            : 'Salir de este place'}
      </button>

      {confirming && !pending ? (
        <button
          type="button"
          onClick={() => {
            setConfirming(false)
            setError(null)
          }}
          className="w-full text-xs text-neutral-500 underline"
        >
          Cancelar
        </button>
      ) : null}
    </div>
  )
}

function friendlyMessage(err: unknown): string {
  if (isDomainError(err)) {
    switch (err.code) {
      case 'VALIDATION':
        return err.message
      case 'AUTHORIZATION':
        return 'Tu sesión expiró. Iniciá sesión de nuevo.'
      case 'NOT_FOUND':
        return 'Ya no sos miembro de este place.'
      case 'INVARIANT_VIOLATION':
        return err.message
      case 'CONFLICT':
        return err.message
      default:
        return 'No se pudo salir del place.'
    }
  }
  return 'Error inesperado. Intentá de nuevo.'
}
