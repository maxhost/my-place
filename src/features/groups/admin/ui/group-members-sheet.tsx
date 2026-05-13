'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  EditPanel,
  EditPanelBody,
  EditPanelClose,
  EditPanelContent,
  EditPanelDescription,
  EditPanelFooter,
  EditPanelHeader,
  EditPanelTitle,
} from '@/shared/ui/edit-panel'
import { toast } from '@/shared/ui/toaster'
import { MemberAvatar } from '@/features/members/public'
import {
  addMemberToGroupAction,
  removeMemberFromGroupAction,
  type GroupMembership,
} from '@/features/groups/public'
import { friendlyGroupErrorMessage } from '@/features/groups/ui/errors'

type AvailableMember = {
  userId: string
  displayName: string
  handle: string | null
  avatarUrl: string | null
}

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  groupId: string
  groupName: string
  /** Miembros actuales del grupo (snapshot del server al render). */
  currentMembers: ReadonlyArray<GroupMembership>
  /** Miembros activos del place que NO están aún en el grupo. */
  availableMembers: ReadonlyArray<AvailableMember>
}

/**
 * EditPanel de gestión de miembros de un grupo. Owner-only.
 *
 * UX (modelado en `<ContributorsSheet>` del slice `library`, canónico):
 *  - Lista de miembros actuales con avatar + nombre + handle + botón
 *    "Quitar" inline.
 *  - Buscador con autocomplete sobre `availableMembers` filtrando los
 *    que ya están en el grupo (max 8 candidatos).
 *  - Click en un resultado → `addMemberToGroupAction`.
 *  - Click en "Quitar" → `removeMemberFromGroupAction`.
 *
 * Optimistic local update (`useState`) para feedback óptico instantáneo;
 * la revalidación del server (vía `revalidatePath` en la action) sincroniza
 * después. Si la action falla, hace rollback local.
 *
 * El `query` se resetea al cerrar; `list` se mantiene con el último
 * estado óptico — el padre re-monta con datos frescos al próximo render
 * post-revalidate.
 */
export function GroupMembersSheet({
  open,
  onOpenChange,
  groupId,
  groupName,
  currentMembers,
  availableMembers,
}: Props): React.ReactNode {
  const [pending, startTransition] = useTransition()
  const [list, setList] = useState<ReadonlyArray<GroupMembership>>(currentMembers)
  const [available, setAvailable] = useState<ReadonlyArray<AvailableMember>>(availableMembers)
  const [query, setQuery] = useState('')

  // Sincroniza el state local cuando el padre re-renderea con props
  // frescos (post-revalidatePath). Sin esto, el sheet queda mostrando el
  // optimistic stale después de cerrar y reabrir.
  useEffect(() => {
    setList(currentMembers)
    setAvailable(availableMembers)
  }, [currentMembers, availableMembers])

  useEffect(() => {
    if (!open) {
      setQuery('')
    }
  }, [open])

  const invitedIds = useMemo(() => new Set(list.map((m) => m.userId)), [list])

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return available
      .filter((m) => !invitedIds.has(m.userId))
      .filter((m) => {
        if (q.length === 0) return true
        return (
          m.displayName.toLowerCase().includes(q) || (m.handle?.toLowerCase().includes(q) ?? false)
        )
      })
      .slice(0, 8)
  }, [available, invitedIds, query])

  function add(target: AvailableMember): void {
    const previous = list
    const optimistic: GroupMembership = {
      id: `optimistic-${target.userId}`,
      groupId,
      userId: target.userId,
      placeId: '',
      addedAt: new Date(),
      addedByUserId: null,
      user: {
        displayName: target.displayName,
        handle: target.handle,
        avatarUrl: target.avatarUrl,
      },
    }
    setList([...list, optimistic])
    setQuery('')

    startTransition(async () => {
      try {
        const result = await addMemberToGroupAction({
          groupId,
          userId: target.userId,
        })
        if (!result.ok) {
          setList(previous)
          if (result.error === 'target_user_not_member') {
            toast.error('Ese miembro ya no está activo en el place.')
          } else if (result.error === 'target_is_owner') {
            toast.error('El owner no puede asignarse a grupos — ya tiene todos los permisos.')
          } else if (result.error === 'already_in_group') {
            toast.info(`${target.displayName} ya estaba en el grupo.`)
          }
          return
        }
        toast.success(`${target.displayName} fue agregado.`)
      } catch (err) {
        setList(previous)
        toast.error(friendlyGroupErrorMessage(err))
      }
    })
  }

  function remove(target: GroupMembership): void {
    const previous = list
    setList(list.filter((m) => m.userId !== target.userId))

    startTransition(async () => {
      try {
        const result = await removeMemberFromGroupAction({
          groupId,
          userId: target.userId,
        })
        if (!result.ok) {
          if (result.error === 'not_in_group') {
            toast.message(`${target.user.displayName} ya no estaba en el grupo.`)
          }
          return
        }
        toast.success(`${target.user.displayName} fue quitado.`)
      } catch (err) {
        setList(previous)
        toast.error(friendlyGroupErrorMessage(err))
      }
    })
  }

  return (
    <EditPanel open={open} onOpenChange={onOpenChange}>
      <EditPanelContent aria-describedby={undefined}>
        <EditPanelHeader>
          <EditPanelTitle>Miembros de “{groupName}”</EditPanelTitle>
          <EditPanelDescription>
            Agregá o quitá miembros del grupo. Los cambios aplican inmediatamente.
          </EditPanelDescription>
        </EditPanelHeader>

        <EditPanelBody>
          <div className="space-y-4 py-2">
            {list.length === 0 ? (
              <p className="text-sm italic text-neutral-500">
                Este grupo todavía no tiene miembros. Agregá desde el buscador.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
                {list.map((member) => (
                  <li key={member.userId} className="flex min-h-[56px] items-center gap-3 py-2">
                    <MemberAvatar
                      userId={member.userId}
                      displayName={member.user.displayName}
                      avatarUrl={member.user.avatarUrl}
                      size={32}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{member.user.displayName}</p>
                      {member.user.handle ? (
                        <p className="truncate text-xs text-neutral-600">@{member.user.handle}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(member)}
                      disabled={pending}
                      className="inline-flex min-h-11 items-center rounded-md px-3 text-xs text-neutral-600 hover:text-neutral-900 disabled:opacity-60"
                      aria-label={`Quitar a ${member.user.displayName}`}
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div>
              <label className="block">
                <span className="mb-1 block text-sm text-neutral-600">Agregar miembro</span>
                <input
                  type="text"
                  placeholder="Buscar miembro por nombre o handle…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="block min-h-[44px] w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base focus:border-neutral-500 focus:outline-none"
                />
              </label>

              {query.trim().length > 0 || candidates.length > 0 ? (
                <ul className="mt-2 divide-y divide-neutral-200 border-y border-neutral-200">
                  {candidates.length === 0 ? (
                    <li className="py-3 text-sm italic text-neutral-500">
                      {query.trim().length > 0
                        ? 'Ningún miembro coincide.'
                        : 'No hay miembros disponibles para agregar.'}
                    </li>
                  ) : (
                    candidates.map((m) => (
                      <li key={m.userId}>
                        <button
                          type="button"
                          onClick={() => add(m)}
                          disabled={pending}
                          className="flex min-h-[56px] w-full items-center gap-3 py-2 text-left hover:bg-neutral-50 disabled:opacity-60"
                        >
                          <MemberAvatar
                            userId={m.userId}
                            displayName={m.displayName}
                            avatarUrl={m.avatarUrl}
                            size={32}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{m.displayName}</p>
                            {m.handle ? (
                              <p className="truncate text-xs text-neutral-600">@{m.handle}</p>
                            ) : null}
                          </div>
                          <span className="inline-flex min-h-11 items-center px-2 text-xs text-neutral-700">
                            Agregar
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </div>
          </div>
        </EditPanelBody>

        <EditPanelFooter>
          <EditPanelClose asChild>
            <button
              type="button"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white"
            >
              Listo
            </button>
          </EditPanelClose>
        </EditPanelFooter>
      </EditPanelContent>
    </EditPanel>
  )
}
