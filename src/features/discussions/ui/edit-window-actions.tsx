'use client'

import { useEffect, useState } from 'react'
import { EDIT_WINDOW_MS } from '../domain/invariants'
import { EditWindowForm } from './edit-window-form'
import { EditWindowConfirmDelete } from './edit-window-confirm-delete'
import type { EditWindowSubject } from './edit-window-types'

/**
 * Acciones editar/eliminar para el autor dentro de los 60s. Tras expirar la
 * ventana, el componente deja de renderizar. Admin tiene flujos separados
 * (no aplica acá — lo cubre C.G).
 *
 * Composición:
 *  - Root (este archivo): gestiona el countdown + modo (`idle`/`edit`/`confirm-delete`).
 *  - `EditWindowForm`: formulario inline de edición con session token.
 *  - `EditWindowConfirmDelete`: confirmación + delete action.
 *  - `edit-window-types.ts`: tipos compartidos.
 */

export type { EditWindowSubject, PostSubject, CommentSubject } from './edit-window-types'

type Props = { subject: EditWindowSubject }

export function EditWindowActions({ subject }: Props): React.ReactNode {
  const [remaining, setRemaining] = useState(() => remainingMs(subject.createdAt, new Date()))
  const [mode, setMode] = useState<'idle' | 'edit' | 'confirm-delete'>('idle')

  useEffect(() => {
    if (remaining <= 0) return
    const id = setInterval(() => {
      setRemaining(remainingMs(subject.createdAt, new Date()))
    }, 2_000)
    return () => clearInterval(id)
  }, [subject.createdAt, remaining])

  if (mode === 'edit') {
    return <EditWindowForm subject={subject} onDone={() => setMode('idle')} />
  }

  if (mode === 'confirm-delete') {
    return <EditWindowConfirmDelete subject={subject} onCancel={() => setMode('idle')} />
  }

  if (remaining <= 0) return null

  const seconds = Math.ceil(remaining / 1000)
  return (
    <div className="mt-2 flex items-center gap-3 text-xs text-muted">
      <button
        type="button"
        onClick={() => setMode('edit')}
        className="text-muted hover:text-text focus:outline-none focus-visible:underline"
      >
        Editar
      </button>
      <button
        type="button"
        onClick={() => setMode('confirm-delete')}
        className="text-muted hover:text-text focus:outline-none focus-visible:underline"
      >
        Eliminar
      </button>
      <span aria-live="polite">{seconds}s restantes</span>
    </div>
  )
}

function remainingMs(createdAt: Date, now: Date): number {
  return Math.max(0, EDIT_WINDOW_MS - (now.getTime() - createdAt.getTime()))
}
