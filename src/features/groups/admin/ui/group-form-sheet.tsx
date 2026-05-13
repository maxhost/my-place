'use client'

import { useEffect, useState, useTransition } from 'react'
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
import {
  GROUP_DESCRIPTION_MAX_LENGTH,
  GROUP_NAME_MAX_LENGTH,
} from '@/features/groups/domain/invariants'
import type { Permission } from '@/features/groups/domain/permissions'
import { createGroupAction, updateGroupAction } from '@/features/groups/public'
import { friendlyGroupErrorMessage } from '@/features/groups/ui/errors'
import { PermissionCheckboxList } from '@/features/groups/ui/permission-checkbox-list'

type CreateMode = {
  kind: 'create'
  placeSlug: string
}

type EditMode = {
  kind: 'edit'
  groupId: string
  initialName: string
  initialDescription: string | null
  initialPermissions: ReadonlyArray<Permission>
  /**
   * Si `true`, el grupo es el preset "Administradores": el form bloquea
   * cambios a permisos (UI los muestra disabled), permite cambios
   * a name y description.
   */
  isPreset: boolean
}

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  mode: CreateMode | EditMode
}

/**
 * EditPanel responsive con form para crear o editar un grupo de permisos.
 *
 * **Migración a `<EditPanel>` (S7, 2026-05-13):** antes usaba
 * `<BottomSheet>` plano (mobile-only). Ahora el primitive `<EditPanel>`
 * responsive lo extiende a desktop como side drawer derecho 520px.
 *
 * API totalmente controlada: el padre maneja `open` + `onOpenChange` +
 * `mode`. Sigue el patrón canónico de `<CategoryFormSheet>` del slice
 * `library` (`docs/ux-patterns.md` § "Side drawer responsive").
 *
 * Submit dispara `createGroupAction` o `updateGroupAction` según modo.
 * Pending state via `useTransition`. Toast por outcome (Sonner).
 *
 * Si modo edit + preset: permissions y scope se muestran disabled con
 * hint "El preset Administradores tiene todos los permisos por defecto."
 *
 * Touch targets: inputs `min-h-[44px] text-base` (16px → evita iOS
 * auto-zoom al focusar). Submit `min-h-12`, cancel `min-h-11`.
 */
export function GroupFormSheet({ open, onOpenChange, mode }: Props): React.ReactNode {
  const [pending, startTransition] = useTransition()

  const initialName = mode.kind === 'create' ? '' : mode.initialName
  const initialDescription = mode.kind === 'create' ? '' : (mode.initialDescription ?? '')
  const initialPermissions = mode.kind === 'create' ? [] : [...mode.initialPermissions]
  const isPreset = mode.kind === 'edit' && mode.isPreset

  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [permissions, setPermissions] = useState<Permission[]>(initialPermissions)

  // Reset al abrir el sheet — sin esto, abrir en `edit` después de un
  // `create` (o viceversa) muestra los valores del modo previo. Mismo
  // patrón que `CategoryFormSheet`.
  useEffect(() => {
    if (open) {
      setName(initialName)
      setDescription(initialDescription)
      setPermissions(initialPermissions)
    }
    // `mode` es estable durante una apertura — el padre sólo lo cambia
    // mientras `open=false`. Listamos `open` como dep principal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function handleCreateSubmit(): void {
    if (mode.kind !== 'create') return
    startTransition(async () => {
      try {
        const result = await createGroupAction({
          placeSlug: mode.placeSlug,
          name,
          description: description.trim().length > 0 ? description : undefined,
          permissions,
        })
        if (!result.ok) {
          if (result.error === 'group_name_taken') {
            toast.error('Ya existe un grupo con ese nombre en el place.')
          } else if (result.error === 'permission_invalid') {
            toast.error('Algún permiso es inválido. Refrescá la page.')
          }
          return
        }
        toast.success('Grupo creado.')
        onOpenChange(false)
      } catch (err) {
        toast.error(friendlyGroupErrorMessage(err))
      }
    })
  }

  function handleUpdateSubmit(): void {
    if (mode.kind !== 'edit') return
    startTransition(async () => {
      try {
        const result = await updateGroupAction({
          groupId: mode.groupId,
          name,
          description: description.trim().length > 0 ? description : undefined,
          permissions,
        })
        if (!result.ok) {
          if (result.error === 'group_name_taken') {
            toast.error('Ya existe un grupo con ese nombre.')
          } else if (result.error === 'permission_invalid') {
            toast.error('Algún permiso es inválido. Refrescá la page.')
          } else if (result.error === 'cannot_modify_preset') {
            toast.error('El preset Administradores no se puede modificar.')
          }
          return
        }
        toast.success('Grupo actualizado.')
        onOpenChange(false)
      } catch (err) {
        toast.error(friendlyGroupErrorMessage(err))
      }
    })
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (name.trim().length === 0) {
      toast.error('Pone un nombre al grupo.')
      return
    }
    if (mode.kind === 'create') {
      handleCreateSubmit()
    } else {
      handleUpdateSubmit()
    }
  }

  const titleText = mode.kind === 'create' ? 'Nuevo grupo' : 'Editar grupo'
  const descriptionText =
    mode.kind === 'create'
      ? 'Definí un grupo con permisos atómicos. Asigná miembros después de crearlo.'
      : isPreset
        ? 'Editá nombre y descripción. Los permisos del preset no se pueden modificar.'
        : 'Modificá nombre, descripción, permisos y scope.'
  const submitText =
    mode.kind === 'create'
      ? pending
        ? 'Creando…'
        : 'Crear grupo'
      : pending
        ? 'Guardando…'
        : 'Guardar cambios'

  return (
    <EditPanel open={open} onOpenChange={onOpenChange}>
      <EditPanelContent aria-describedby={undefined}>
        <EditPanelHeader>
          <EditPanelTitle>{titleText}</EditPanelTitle>
          <EditPanelDescription>{descriptionText}</EditPanelDescription>
        </EditPanelHeader>

        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <EditPanelBody>
            <div className="space-y-4 py-2">
              <label className="block">
                <span className="mb-1 block text-sm text-neutral-600">Nombre</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={GROUP_NAME_MAX_LENGTH}
                  disabled={pending}
                  placeholder="Moderadores, Recruiters, Library Mods…"
                  className="block min-h-[44px] w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base focus:border-neutral-500 focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm text-neutral-600">Descripción (opcional)</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={GROUP_DESCRIPTION_MAX_LENGTH}
                  rows={2}
                  disabled={pending}
                  placeholder="Qué hace este grupo."
                  className="block min-h-[60px] w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base focus:border-neutral-500 focus:outline-none"
                />
              </label>

              <div>
                <span className="mb-1 block text-sm text-neutral-600">Permisos</span>
                <PermissionCheckboxList
                  value={permissions}
                  onChange={setPermissions}
                  disabled={pending || isPreset}
                />
                {isPreset && (
                  <p className="mt-1 text-xs text-neutral-600">
                    El preset Administradores tiene todos los permisos por defecto.
                  </p>
                )}
              </div>
            </div>
          </EditPanelBody>

          <EditPanelFooter>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-60"
            >
              {submitText}
            </button>
            <EditPanelClose asChild>
              <button
                type="button"
                disabled={pending}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-neutral-300 px-4 text-sm disabled:opacity-60"
              >
                Cancelar
              </button>
            </EditPanelClose>
          </EditPanelFooter>
        </form>
      </EditPanelContent>
    </EditPanel>
  )
}
