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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { deletePostAction, hidePostAction, unhidePostAction } from '../server/actions/posts'
import { friendlyErrorMessage } from './utils'

/**
 * Menú contextual admin para un post. Acciones: Ocultar/Mostrar (toggle) y
 * Eliminar. Ninguna depende de la ventana de 60s: admin bypasea.
 *
 * Delete abre un Dialog de confirmación porque el hard delete es irreversible
 * (ver `hardDeletePost`). El hide/unhide es reversible, así que va directo.
 *
 * Este menú se renderiza SÓLO para admins. La lógica "admin ≠ autor" la
 * decide el caller (`PostDetail`): si admin es también autor, se renderiza
 * tanto este menú como `EditWindowActions` — son ortogonales (admin quitaría
 * de la conversación del place; autor edita su propio texto).
 */
export function PostAdminMenu({
  postId,
  hiddenAt,
  expectedVersion,
}: {
  postId: string
  hiddenAt: Date | null
  expectedVersion: number
}): React.ReactNode {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleHidden = () => {
    setError(null)
    startTransition(async () => {
      try {
        if (hiddenAt) {
          await unhidePostAction({ postId, expectedVersion })
        } else {
          await hidePostAction({ postId, expectedVersion })
        }
      } catch (err) {
        setError(friendlyErrorMessage(err))
      }
    })
  }

  const confirmDelete = () => {
    setError(null)
    startTransition(async () => {
      try {
        await deletePostAction({ postId, expectedVersion })
        setConfirmOpen(false)
        router.replace('/conversations')
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
            className="rounded p-1 text-muted hover:text-text focus:outline-none focus-visible:ring-1 focus-visible:ring-bg"
            disabled={pending}
          >
            <KebabIcon />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onSelect={() => router.push(`/conversations/new?edit=${postId}`)}
            disabled={pending}
          >
            Editar
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={toggleHidden} disabled={pending}>
            {hiddenAt ? 'Mostrar' : 'Ocultar'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
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
        <DialogContent aria-describedby="delete-post-desc">
          <DialogTitle>¿Eliminar este post?</DialogTitle>
          <DialogDescription id="delete-post-desc">
            Se eliminan el post, sus comentarios y reacciones. No se puede deshacer.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose asChild>
              <button
                type="button"
                disabled={pending}
                className="rounded px-3 py-1 text-sm text-muted hover:text-text"
              >
                Cancelar
              </button>
            </DialogClose>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={pending}
              className="rounded bg-accent px-3 py-1 text-sm text-bg disabled:opacity-60"
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
