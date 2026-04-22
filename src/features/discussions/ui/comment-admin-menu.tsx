'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/shared/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { deleteCommentAction } from '../server/actions/comments'
import { friendlyErrorMessage } from './utils'

/**
 * Menú contextual admin para un comment. Única acción: Eliminar. Comments no
 * se ocultan — la estructura del thread se preserva con placeholder
 * `[mensaje eliminado]`. Si admin es autor dentro de los 60s, este menú
 * coexiste con `EditWindowActions` (ambas llevan al mismo `deleteCommentAction`,
 * pero autor-via-menú sigue funcionando cuando la ventana expira).
 */
export function CommentAdminMenu({
  commentId,
  expectedVersion,
}: {
  commentId: string
  expectedVersion: number
}): React.ReactNode {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmDelete = () => {
    setError(null)
    startTransition(async () => {
      try {
        await deleteCommentAction({ commentId, expectedVersion })
        setConfirmOpen(false)
        router.refresh()
      } catch (err) {
        setError(friendlyErrorMessage(err))
      }
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Acciones de moderación"
            className="rounded p-1 text-place-text-soft hover:text-place-text focus:outline-none focus-visible:ring-1 focus-visible:ring-place-mark-fg"
            disabled={pending}
          >
            <KebabIcon />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              setConfirmOpen(true)
            }}
            disabled={pending}
            destructive
          >
            Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error ? (
        <p role="alert" aria-live="polite" className="mt-1 text-xs text-amber-700">
          {error}
        </p>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent aria-describedby="delete-comment-desc">
          <DialogTitle>¿Eliminar este comentario?</DialogTitle>
          <DialogDescription id="delete-comment-desc">
            El texto se reemplaza por &laquo;mensaje eliminado&raquo; y queda en el thread.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose asChild>
              <button
                type="button"
                disabled={pending}
                className="rounded px-3 py-1 text-sm text-place-text-soft hover:text-place-text"
              >
                Cancelar
              </button>
            </DialogClose>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={pending}
              className="rounded bg-place-mark-bg px-3 py-1 text-sm text-place-mark-fg disabled:opacity-60"
            >
              {pending ? 'Eliminando…' : 'Sí, eliminar'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function KebabIcon(): React.ReactNode {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="8" cy="3" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="8" cy="13" r="1.3" />
    </svg>
  )
}
