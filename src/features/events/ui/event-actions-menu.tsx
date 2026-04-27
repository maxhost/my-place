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
import { cancelEventAction } from '../server/actions/cancel'
import { friendlyEventErrorMessage } from './errors'

/**
 * Kebab del thread cuando éste es un event-thread (F.F: el evento ES el
 * thread). Reemplaza el `<PostAdminMenu>` para los event-threads y
 * extiende la visibilidad a author + admin (no solo admin).
 *
 * Items:
 *  - **Editar evento** → navega a `/events/[id]/edit`.
 *  - **Cancelar evento** → Dialog de confirmación + `cancelEventAction`
 *    (soft-cancel: preserva RSVPs y el Post asociado).
 *
 * Si el evento ya está cancelado (`cancelled`), el item Cancelar
 * desaparece — solo Editar evento queda disponible.
 *
 * Visibilidad gated por el caller (la page del thread): se monta
 * cuando `(isAuthor || viewerIsAdmin) && post.event`. Reemplaza el
 * footer de `<EventMetadataHeader>` que tenía estas dos acciones.
 *
 * Patrón visual idéntico a `<PostAdminMenu>` para coherencia del
 * kebab cross-feature.
 */
type Props = {
  eventId: string
  cancelled: boolean
}

export function EventActionsMenu({ eventId, cancelled }: Props): React.ReactNode {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmCancel = (): void => {
    setError(null)
    startTransition(async () => {
      try {
        await cancelEventAction({ eventId })
        setConfirmOpen(false)
        router.refresh()
      } catch (err) {
        setError(friendlyEventErrorMessage(err))
      }
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Acciones del evento"
            disabled={pending}
            className="rounded p-1 text-muted hover:text-text focus:outline-none focus-visible:ring-1 focus-visible:ring-bg"
          >
            <KebabIcon />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onSelect={() => router.push(`/events/${eventId}/edit`)}
            disabled={pending}
          >
            Editar evento
          </DropdownMenuItem>
          {!cancelled ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  setConfirmOpen(true)
                }}
                disabled={pending}
                destructive
              >
                Cancelar evento
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {error ? (
        <p role="alert" aria-live="polite" className="mt-1 text-xs text-amber-700">
          {error}
        </p>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent aria-describedby="cancel-event-desc">
          <DialogTitle>¿Cancelar este evento?</DialogTitle>
          <DialogDescription id="cancel-event-desc">
            El evento queda marcado como cancelado. La conversación y los RSVPs se preservan — los
            miembros pueden seguir leyendo el thread.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose asChild>
              <button
                type="button"
                disabled={pending}
                className="rounded px-3 py-1 text-sm text-muted hover:text-text"
              >
                Volver
              </button>
            </DialogClose>
            <button
              type="button"
              onClick={confirmCancel}
              disabled={pending}
              className="rounded bg-amber-600 px-3 py-1 text-sm text-bg disabled:opacity-60"
            >
              {pending ? 'Cancelando…' : 'Sí, cancelar'}
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
