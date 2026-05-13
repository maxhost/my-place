'use client'

import { Pencil, Trash2, Users } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  EditPanel,
  EditPanelBody,
  EditPanelContent,
  EditPanelFooter,
  EditPanelHeader,
  EditPanelTitle,
} from '@/shared/ui/edit-panel'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog'
import { toast } from '@/shared/ui/toaster'
import { MemberAvatar } from '@/features/members/public'
import {
  deleteGroupAction,
  permissionLabel,
  type GroupMembership,
  type Permission,
  type PermissionGroup,
} from '@/features/groups/public'
import { friendlyGroupErrorMessage } from '@/features/groups/ui/errors'

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  /**
   * Grupo a mostrar. `null` cuando el panel está cerrado y nunca se
   * abrió. Internamente latcheamos el último valor non-null para que
   * el contenido sobreviva la animación de cierre (Radix Presence
   * necesita el subtree presente para animar el exit — si el parent
   * desmonta vía `{group ? ... : null}`, la animation se skipea).
   */
  group: PermissionGroup | null
  /** Miembros del grupo. Vacío si el grupo no tiene miembros. */
  members: ReadonlyArray<GroupMembership>
  placeSlug: string
  onEdit: () => void
  onManageMembers: () => void
}

/**
 * Panel de detalle (read-only) de un grupo de permisos.
 *
 * **Patrón canónico `detail-from-list`** (S7, 2026-05-13): click en la
 * row de un grupo abre este panel. EditPanel responsive: side drawer
 * desktop / bottom sheet mobile. Mirror del `<CategoryDetailPanel>` del
 * slice library — la única primitive UX para detail-from-list.
 *
 * Contenido:
 *  - Header: name + chip "preset" si aplica.
 *  - Sección "Permisos" — chips con labels español. Empty state si lista vacía.
 *  - Sección "Miembros" — count + avatares + "Gestionar miembros" trigger.
 *  - Footer: "Editar" primary filled + "Eliminar" destructive (solo si custom + sin miembros).
 *
 * Preset "Administradores": footer solo muestra "Editar" (no Eliminar) +
 * tooltip explicativo si delete no aplica.
 *
 * Latch: preservamos last non-null `group`/`members` para que Radix
 * Presence anime el exit del Content cuando `open` flipea a false.
 */
export function GroupDetailPanel({
  open,
  onOpenChange,
  group,
  members,
  placeSlug,
  onEdit,
  onManageMembers,
}: Props): React.ReactNode {
  const router = useRouter()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingDelete, startDelete] = useTransition()

  // Latch: preserva último `{group, members}` non-null para Radix Presence.
  const [latched, setLatched] = useState<{
    group: PermissionGroup
    members: ReadonlyArray<GroupMembership>
  } | null>(null)
  useEffect(() => {
    if (group) setLatched({ group, members })
  }, [group, members])

  const displayGroup = group ?? latched?.group ?? null
  const displayMembers = group ? members : (latched?.members ?? [])

  if (!displayGroup) return null

  const isPreset = displayGroup.isPreset
  const hasMembers = displayMembers.length > 0
  const deleteBlockedReason = isPreset
    ? 'El preset Administradores no se puede eliminar.'
    : hasMembers
      ? 'Quitá los miembros del grupo antes de eliminar.'
      : null

  function handleDeleteConfirm(): void {
    if (!displayGroup || pendingDelete) return
    startDelete(async () => {
      try {
        const result = await deleteGroupAction({ groupId: displayGroup.id })
        if (!result.ok) {
          if (result.error === 'cannot_delete_preset') {
            toast.error('El preset Administradores no se puede eliminar.')
          } else if (result.error === 'group_has_members') {
            toast.error('Quitá los miembros del grupo antes de eliminar.')
          }
          setConfirmDelete(false)
          return
        }
        toast.success(`Grupo "${displayGroup.name}" eliminado.`)
        setConfirmDelete(false)
        onOpenChange(false)
        // Refresh para reflejar la lista sin el grupo.
        router.refresh()
      } catch (err) {
        toast.error(friendlyGroupErrorMessage(err))
        setConfirmDelete(false)
      }
    })
  }

  return (
    <>
      <EditPanel open={open} onOpenChange={onOpenChange}>
        <EditPanelContent aria-describedby={undefined}>
          <EditPanelHeader>
            <EditPanelTitle>
              <span className="flex items-center gap-2">
                <span className="truncate">{displayGroup.name}</span>
                {isPreset ? (
                  <span className="shrink-0 rounded-full border border-amber-300 px-2 py-0.5 text-[11px] text-amber-700">
                    preset
                  </span>
                ) : null}
              </span>
            </EditPanelTitle>
          </EditPanelHeader>

          <EditPanelBody>
            <div className="space-y-5 py-2">
              {displayGroup.description ? (
                <p className="text-sm text-neutral-700">{displayGroup.description}</p>
              ) : null}

              <section className="space-y-2">
                <h3
                  className="border-b pb-2 font-serif text-base"
                  style={{ borderColor: 'var(--border)' }}
                >
                  Permisos
                </h3>
                <PermissionChips permissions={displayGroup.permissions} />
              </section>

              <section className="space-y-2">
                <div
                  className="flex items-baseline justify-between gap-2 border-b pb-2"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <h3 className="font-serif text-base">Miembros</h3>
                  <span className="text-xs text-neutral-600">{displayMembers.length}</span>
                </div>
                {displayMembers.length === 0 ? (
                  <p className="text-sm italic text-neutral-500">
                    Este grupo no tiene miembros asignados.
                  </p>
                ) : (
                  <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
                    {displayMembers.map((m) => (
                      <li key={m.id} className="flex min-h-[48px] items-center gap-3 py-2">
                        <MemberAvatar
                          userId={m.userId}
                          displayName={m.user.displayName}
                          avatarUrl={m.user.avatarUrl}
                          size={28}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{m.user.displayName}</p>
                          {m.user.handle ? (
                            <p className="truncate text-xs text-neutral-600">@{m.user.handle}</p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={onManageMembers}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-50"
                >
                  <Users aria-hidden="true" className="h-4 w-4" />
                  Gestionar miembros
                </button>
              </section>
            </div>
          </EditPanelBody>

          <EditPanelFooter>
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-neutral-900 px-4 text-sm font-medium text-white"
            >
              <Pencil aria-hidden="true" className="h-4 w-4" />
              Editar
            </button>
            {deleteBlockedReason ? (
              <button
                type="button"
                disabled
                title={deleteBlockedReason}
                className="inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-md px-4 text-sm font-medium text-neutral-400 opacity-60"
                aria-label={`No se puede eliminar ${displayGroup.name}`}
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
                Eliminar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={pendingDelete}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
                Eliminar
              </button>
            )}
            {deleteBlockedReason ? (
              <p className="text-xs italic text-neutral-500">{deleteBlockedReason}</p>
            ) : null}
          </EditPanelFooter>
        </EditPanelContent>
      </EditPanel>

      {/* Confirm dialog para delete — inline con state local, igual que
          `<CategoryDetailPanel>`. */}
      <Dialog
        open={confirmDelete}
        onOpenChange={(next) => {
          if (!next) setConfirmDelete(false)
        }}
      >
        <DialogContent>
          <DialogTitle>{`¿Eliminar "${displayGroup.name}"?`}</DialogTitle>
          <DialogDescription>
            Los miembros del grupo perderán los permisos asociados. Esta acción no se puede
            deshacer.
          </DialogDescription>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              disabled={pendingDelete}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-300 px-4 text-sm disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleDeleteConfirm}
              disabled={pendingDelete}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-red-600 bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {pendingDelete ? 'Eliminando…' : 'Sí, eliminar'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Mantengo placeSlug en la firma por compatibilidad futura — el
          delete via deleteGroupAction no requiere redirect explícito (la
          page actual se queda con la lista actualizada via router.refresh). */}
      <span aria-hidden className="hidden" data-place-slug={placeSlug} />
    </>
  )
}

function PermissionChips({
  permissions,
}: {
  permissions: ReadonlyArray<Permission>
}): React.ReactNode {
  if (permissions.length === 0) {
    return (
      <p className="text-sm italic text-neutral-500">
        Sin permisos asignados. Editá el grupo para asignar permisos.
      </p>
    )
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {permissions.map((p) => (
        <li
          key={p}
          className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700"
        >
          {permissionLabel(p)}
        </li>
      ))}
    </ul>
  )
}
