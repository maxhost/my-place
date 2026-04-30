'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/shared/ui/dialog'
import { toast } from '@/shared/ui/toaster'
import { MemberAvatar } from '@/features/members/public'
import {
  inviteContributorAction,
  removeContributorAction,
  type LibraryCategoryContributor,
} from '@/features/library/public'
import { friendlyLibraryErrorMessage } from './errors'

type MemberOption = {
  userId: string
  displayName: string
  avatarUrl: string | null
  handle: string | null
}

type Props = {
  categoryId: string
  categoryTitle: string
  /** Lista actual de contributors (snapshot del server al render). El
   *  componente mantiene una copia local mutable para feedback óptico
   *  antes de que el revalidate llegue. */
  initialContributors: ReadonlyArray<LibraryCategoryContributor>
  /** Members activos del place — fuente para el picker. Se pasa desde
   *  el page padre (ya cargado vía `listActiveMembers`). */
  members: ReadonlyArray<MemberOption>
  /** Render del trigger (botón row admin). */
  trigger: React.ReactNode
}

/**
 * Modal para gestionar contribuidores designated de una categoría.
 *
 * Solo aplica cuando `category.contributionPolicy === 'DESIGNATED'`.
 * El page padre decide cuándo montar el botón trigger según la policy
 * de cada categoría.
 *
 * UX:
 *  - Lista de contributors actuales con avatar + nombre + botón "Quitar"
 *    inline.
 *  - Input de búsqueda con autocomplete sobre `members` filtrando los
 *    que ya están invitados.
 *  - Click en un resultado → `inviteContributorAction`.
 *  - Click en "Quitar" → `removeContributorAction`.
 *
 * Optimistic local update (`useState`) para que el cambio se vea al
 * instante; la revalidación del server (vía `revalidatePath` en la
 * action) sincroniza después. Si la action falla, se hace rollback
 * local.
 */
export function ContributorsDialog({
  categoryId,
  categoryTitle,
  initialContributors,
  members,
  trigger,
}: Props): React.ReactNode {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [list, setList] = useState<ReadonlyArray<LibraryCategoryContributor>>(initialContributors)
  const [query, setQuery] = useState('')

  const invitedIds = useMemo(() => new Set(list.map((c) => c.userId)), [list])

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return members
      .filter((m) => !invitedIds.has(m.userId))
      .filter((m) => {
        if (q.length === 0) return true
        return (
          m.displayName.toLowerCase().includes(q) || (m.handle?.toLowerCase().includes(q) ?? false)
        )
      })
      .slice(0, 8)
  }, [members, invitedIds, query])

  function invite(target: MemberOption): void {
    const previous = list
    const optimistic: LibraryCategoryContributor = {
      categoryId,
      userId: target.userId,
      displayName: target.displayName,
      avatarUrl: target.avatarUrl,
      invitedAt: new Date(),
      invitedByUserId: 'self',
      invitedByDisplayName: 'Vos',
    }
    setList([...list, optimistic])
    setQuery('')

    startTransition(async () => {
      try {
        const res = await inviteContributorAction({ categoryId, userId: target.userId })
        if (res.alreadyInvited) {
          toast.info(`${target.displayName} ya estaba invitado.`)
        } else {
          toast.success(`${target.displayName} fue agregado.`)
        }
      } catch (err) {
        setList(previous)
        toast.error(friendlyLibraryErrorMessage(err))
      }
    })
  }

  function remove(target: LibraryCategoryContributor): void {
    const previous = list
    setList(list.filter((c) => c.userId !== target.userId))

    startTransition(async () => {
      try {
        await removeContributorAction({ categoryId, userId: target.userId })
        toast.success(`${target.displayName} fue quitado.`)
      } catch (err) {
        setList(previous)
        toast.error(friendlyLibraryErrorMessage(err))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="contents"
        aria-label={`Gestionar contribuidores de ${categoryTitle}`}
      >
        {trigger}
      </button>
      <DialogContent className="max-w-lg">
        <DialogTitle>Contribuidores de “{categoryTitle}”</DialogTitle>
        <DialogDescription>
          Las personas que pueden agregar contenido en esta categoría. Los admins siempre pueden
          aunque no estén en la lista.
        </DialogDescription>

        <div className="mt-4 space-y-4">
          {list.length === 0 ? (
            <div className="rounded-md border border-border bg-bg p-4 text-sm italic text-muted">
              Todavía nadie tiene permiso. Agregá miembros desde el buscador.
            </div>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-bg">
              {list.map((contributor) => (
                <li key={contributor.userId} className="flex items-center gap-3 px-3 py-2">
                  <MemberAvatar
                    userId={contributor.userId}
                    displayName={contributor.displayName}
                    avatarUrl={contributor.avatarUrl}
                    size={28}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">
                      {contributor.displayName}
                    </p>
                    <p className="truncate text-xs text-muted">
                      Invitado por {contributor.invitedByDisplayName}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(contributor)}
                    disabled={pending}
                    className="rounded-md px-2 py-1 text-xs text-muted hover:text-text disabled:opacity-60"
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div>
            <label className="block">
              <span className="mb-1 block text-sm text-muted">Agregar contribuidor</span>
              <input
                type="text"
                placeholder="Buscar miembro por nombre o handle…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-text focus:outline-none"
              />
            </label>

            {query.trim().length > 0 || candidates.length > 0 ? (
              <ul className="mt-2 max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border bg-bg">
                {candidates.length === 0 ? (
                  <li className="px-3 py-2 text-sm italic text-muted">
                    {query.trim().length > 0
                      ? 'Ningún miembro coincide.'
                      : 'Todos los miembros del place ya están invitados.'}
                  </li>
                ) : (
                  candidates.map((m) => (
                    <li key={m.userId}>
                      <button
                        type="button"
                        onClick={() => invite(m)}
                        disabled={pending}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-soft disabled:opacity-60"
                      >
                        <MemberAvatar
                          userId={m.userId}
                          displayName={m.displayName}
                          avatarUrl={m.avatarUrl}
                          size={28}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-text">{m.displayName}</p>
                          {m.handle ? (
                            <p className="truncate text-xs text-muted">@{m.handle}</p>
                          ) : null}
                        </div>
                        <span className="text-xs text-accent">Invitar</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <DialogClose asChild>
            <button
              type="button"
              className="rounded-md px-3 py-2 text-sm text-muted hover:text-text"
            >
              Listo
            </button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}
