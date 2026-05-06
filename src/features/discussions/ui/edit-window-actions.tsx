'use client'

import { useEffect, useState } from 'react'
import { EDIT_WINDOW_MS } from '../domain/invariants'
import { EditWindowConfirmDelete } from './edit-window-confirm-delete'
import type { EditWindowSubject } from './edit-window-types'

/**
 * Acciones editar/eliminar para el autor dentro de los 60s. Tras expirar la
 * ventana, el componente deja de renderizar.
 *
 * stub F.1: el modo "edit" está deshabilitado durante la migración a Lexical;
 * sólo queda el branch de delete. Se restaura el flujo completo en F.3 (comments)
 * y F.4 (posts) con el composer Lexical.
 */

export type { EditWindowSubject, PostSubject, CommentSubject } from './edit-window-types'

type Props = { subject: EditWindowSubject }

export function EditWindowActions({ subject }: Props): React.ReactNode {
  const [remaining, setRemaining] = useState(() => remainingMs(subject.createdAt, new Date()))
  const [mode, setMode] = useState<'idle' | 'confirm-delete'>('idle')

  useEffect(() => {
    if (remaining <= 0) return
    const id = setInterval(() => {
      setRemaining(remainingMs(subject.createdAt, new Date()))
    }, 2_000)
    return () => clearInterval(id)
  }, [subject.createdAt, remaining])

  if (mode === 'confirm-delete') {
    return <EditWindowConfirmDelete subject={subject} onCancel={() => setMode('idle')} />
  }

  if (remaining <= 0) return null

  const seconds = Math.ceil(remaining / 1000)
  return (
    <div className="mt-2 flex items-center gap-3 text-xs text-muted">
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
