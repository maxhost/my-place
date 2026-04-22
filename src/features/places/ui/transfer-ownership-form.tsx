'use client'

import { useState, useTransition } from 'react'
import { transferOwnershipAction } from '../server/actions'
import { isDomainError } from '@/shared/errors/domain-error'

/**
 * Form para transferir ownership del place al target elegido. Solo puede ser un
 * miembro activo del MISMO place — la lista viene ya filtrada del server component
 * padre (`/[placeSlug]/settings/members`).
 *
 * `removeActor = true` cede también la membership del actor (sale del place). Default
 * `false` deja una co-ownership con el target.
 */

type Candidate = {
  userId: string
  displayName: string
  handle: string | null
}

type Feedback = { kind: 'ok' | 'err'; message: string }

export function TransferOwnershipForm({
  placeSlug,
  candidates,
}: {
  placeSlug: string
  candidates: Candidate[]
}) {
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [toUserId, setToUserId] = useState(candidates[0]?.userId ?? '')
  const [removeActor, setRemoveActor] = useState(false)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFeedback(null)
    if (!toUserId) {
      setFeedback({ kind: 'err', message: 'Elegí un miembro.' })
      return
    }

    startTransition(async () => {
      try {
        await transferOwnershipAction({ placeSlug, toUserId, removeActor })
        if (removeActor) {
          // El actor salió — ya no es miembro, el middleware va a rebotar si se queda.
          window.location.href = '/'
        } else {
          setFeedback({ kind: 'ok', message: 'Ownership transferida.' })
        }
      } catch (err) {
        setFeedback({ kind: 'err', message: friendlyMessage(err) })
      }
    })
  }

  if (candidates.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        No hay otros miembros a quienes transferir. Invitá a alguien primero.
      </p>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {feedback ? (
        <div
          role={feedback.kind === 'ok' ? 'status' : 'alert'}
          className={
            feedback.kind === 'ok'
              ? 'rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900'
              : 'rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900'
          }
        >
          {feedback.message}
        </div>
      ) : null}

      <label className="block text-sm">
        <span className="mb-1 block text-neutral-600">Transferir a</span>
        <select
          value={toUserId}
          onChange={(e) => setToUserId(e.target.value)}
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus:border-neutral-500 focus:outline-none"
        >
          {candidates.map((c) => (
            <option key={c.userId} value={c.userId}>
              {c.displayName}
              {c.handle ? ` (@${c.handle})` : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-start gap-2 text-sm text-neutral-600">
        <input
          type="checkbox"
          className="mt-1"
          checked={removeActor}
          onChange={(e) => setRemoveActor(e.target.checked)}
        />
        <span>
          Dejar de ser owner y salir del place. Si lo dejás sin tildar, vas a compartir ownership.
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-60"
      >
        {pending ? 'Transfiriendo…' : 'Transferir ownership'}
      </button>
    </form>
  )
}

function friendlyMessage(err: unknown): string {
  if (isDomainError(err)) {
    switch (err.code) {
      case 'VALIDATION':
        return err.message
      case 'AUTHORIZATION':
        return 'Solo un owner puede transferir ownership.'
      case 'NOT_FOUND':
        return 'No encontramos este place.'
      case 'INVARIANT_VIOLATION':
        return err.message
      case 'CONFLICT':
        return err.message
      default:
        return 'No se pudo transferir la ownership.'
    }
  }
  return 'Error inesperado. Intentá de nuevo.'
}
