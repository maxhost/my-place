'use client'

import { Pencil, Trash2 } from 'lucide-react'
import {
  EditPanel,
  EditPanelBody,
  EditPanelContent,
  EditPanelDescription,
  EditPanelFooter,
  EditPanelHeader,
  EditPanelTitle,
} from '@/shared/ui/edit-panel'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog'
import { useEffect, useState } from 'react'
import type {
  LibraryCategory,
  LibraryReadAccessKind,
  WriteAccessKind,
} from '@/features/library/public'

type CategoryScope = {
  write: {
    kind: WriteAccessKind
    groupIds: ReadonlyArray<string>
    tierIds: ReadonlyArray<string>
    userIds: ReadonlyArray<string>
  }
  read: {
    kind: LibraryReadAccessKind
    groupIds: ReadonlyArray<string>
    tierIds: ReadonlyArray<string>
    userIds: ReadonlyArray<string>
  }
}

type LabeledId = { id: string; label: string }

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  /**
   * Categoría a mostrar. `null` cuando el panel está cerrado y nunca se
   * abrió. Internamente latcheamos el último valor non-null para que el
   * contenido sobreviva la animación de cierre (Radix Presence necesita
   * el subtree presente para animar el exit — si el parent desmonta vía
   * `{category ? ... : null}`, la animation se skipea).
   */
  category: LibraryCategory | null
  scope: CategoryScope | null
  /** Catalogs para mostrar nombres legibles en lugar de IDs. */
  groupsById: ReadonlyMap<string, string>
  tiersById: ReadonlyMap<string, string>
  membersById: ReadonlyMap<string, string>
  onEdit: () => void
  onArchive: () => void
}

/**
 * Panel de detalle (read-only) de una categoría library.
 *
 * **Patrón canónico `detail-from-list`** (2026-05-13): click en la row
 * de una categoría abre este panel. EditPanel responsive: side drawer
 * en desktop (≥md) / bottom sheet en mobile.
 *
 * Contenido:
 *  - Header: emoji + título + slug.
 *  - Sección "Quién puede escribir" — kind + lista resuelta de
 *    grupos/tiers/usuarios.
 *  - Sección "Quién puede leer" — idem.
 *  - Footer: botones inline "Editar" + "Archivar" (destructive con
 *    confirm dialog).
 *
 * El user puede:
 *  - Click "Editar" → cierra detail, abre wizard en mode=edit.
 *  - Click "Archivar" → confirm dialog → si confirma, archive action.
 *  - ESC / overlay click / X → cierra detail.
 *
 * Read-only: no se editan campos en este panel. Toda mutación pasa por
 * el wizard de edit o por archive action.
 */
export function CategoryDetailPanel({
  open,
  onOpenChange,
  category,
  scope,
  groupsById,
  tiersById,
  membersById,
  onEdit,
  onArchive,
}: Props): React.ReactNode {
  const [confirmArchive, setConfirmArchive] = useState(false)

  // Latch: preservamos el último `{category, scope}` non-null para que
  // Radix Presence pueda animar el exit del Content cuando `open` flipea
  // a false (el parent envía `category=null` post-close, pero el Content
  // necesita seguir en el árbol hasta `animationend`).
  const [latched, setLatched] = useState<{
    category: LibraryCategory
    scope: CategoryScope
  } | null>(null)
  useEffect(() => {
    if (category && scope) setLatched({ category, scope })
  }, [category, scope])

  const displayCategory = category ?? latched?.category ?? null
  const displayScope = scope ?? latched?.scope ?? null

  // Antes del primer open, no hay nada que renderear (evita un Portal
  // huérfano en el DOM al cargar la página).
  if (!displayCategory || !displayScope) return null

  const writeEntries = resolveScopeEntries(displayScope.write, {
    groupsById,
    tiersById,
    membersById,
  })
  const readEntries = resolveScopeEntries(displayScope.read, {
    groupsById,
    tiersById,
    membersById,
  })

  function handleEdit(): void {
    onOpenChange(false)
    // Pequeño delay implícito por la animation de cierre del EditPanel
    // antes de abrir el wizard. El caller (LibraryCategoriesPanel)
    // decide cuándo abre el wizard — acá sólo notificamos.
    onEdit()
  }

  function handleArchiveConfirm(): void {
    setConfirmArchive(false)
    onOpenChange(false)
    onArchive()
  }

  return (
    <>
      <EditPanel open={open} onOpenChange={onOpenChange}>
        <EditPanelContent aria-describedby={undefined}>
          <EditPanelHeader>
            <EditPanelTitle>
              <span aria-hidden className="mr-2 text-2xl leading-none">
                {displayCategory.emoji}
              </span>
              {displayCategory.title}
            </EditPanelTitle>
            <EditPanelDescription>/library/{displayCategory.slug}</EditPanelDescription>
          </EditPanelHeader>

          <EditPanelBody>
            <div className="space-y-5 py-2">
              <DetailSection
                heading="Quién puede escribir"
                kindLabel={writeAccessLabel(displayScope.write.kind)}
                kindHint={writeAccessHint(displayScope.write.kind)}
                entries={writeEntries}
              />
              <DetailSection
                heading="Quién puede leer"
                kindLabel={readAccessLabel(displayScope.read.kind)}
                kindHint={readAccessHint(displayScope.read.kind)}
                entries={readEntries}
              />
              <DetailMeta category={displayCategory} />
            </div>
          </EditPanelBody>

          <EditPanelFooter>
            <button
              type="button"
              onClick={handleEdit}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-neutral-900 px-4 text-sm font-medium text-white"
            >
              <Pencil aria-hidden="true" className="h-4 w-4" />
              Editar
            </button>
            <button
              type="button"
              onClick={() => setConfirmArchive(true)}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              Archivar
            </button>
          </EditPanelFooter>
        </EditPanelContent>
      </EditPanel>

      <Dialog
        open={confirmArchive}
        onOpenChange={(next) => {
          if (!next) setConfirmArchive(false)
        }}
      >
        <DialogContent>
          <DialogTitle>{`¿Archivar "${displayCategory.title}"?`}</DialogTitle>
          <DialogDescription>
            Los items existentes se mantienen pero la categoría se oculta del listado. Reversible
            desde la base de datos.
          </DialogDescription>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setConfirmArchive(false)}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-300 px-4 text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleArchiveConfirm}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-red-600 bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700"
            >
              Sí, archivar
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function DetailSection({
  heading,
  kindLabel,
  kindHint,
  entries,
}: {
  heading: string
  kindLabel: string
  kindHint: string
  entries: ReadonlyArray<LabeledId>
}): React.ReactNode {
  return (
    <section className="space-y-2">
      <h3 className="border-b pb-2 font-serif text-base" style={{ borderColor: 'var(--border)' }}>
        {heading}
      </h3>
      <p className="text-sm text-neutral-900">{kindLabel}</p>
      <p className="text-xs text-neutral-600">{kindHint}</p>
      {entries.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {entries.map((e) => (
            <li
              key={e.id}
              className="inline-flex items-center rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-700"
            >
              {e.label}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function DetailMeta({ category }: { category: LibraryCategory }): React.ReactNode {
  // `category.createdAt` puede ser Date (RSC payload) o string (response
  // de `unstable_cache` que serializa via JSON). Defensive wrap a Date
  // antes de `.toLocaleDateString()` para que ambos cases funcionen.
  const createdAt = new Date(category.createdAt)
  return (
    <section className="space-y-2">
      <h3 className="border-b pb-2 font-serif text-base" style={{ borderColor: 'var(--border)' }}>
        Detalles
      </h3>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-neutral-600">Tipo</dt>
          <dd className="text-neutral-900">{category.kind === 'COURSE' ? 'Curso' : 'General'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-neutral-600">Items</dt>
          <dd className="text-neutral-900">{category.docCount}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-neutral-600">Creada</dt>
          <dd className="text-neutral-900">
            {createdAt.toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </dd>
        </div>
      </dl>
    </section>
  )
}

function resolveScopeEntries(
  scope: {
    kind: WriteAccessKind | LibraryReadAccessKind
    groupIds: ReadonlyArray<string>
    tierIds: ReadonlyArray<string>
    userIds: ReadonlyArray<string>
  },
  catalogs: {
    groupsById: ReadonlyMap<string, string>
    tiersById: ReadonlyMap<string, string>
    membersById: ReadonlyMap<string, string>
  },
): LabeledId[] {
  switch (scope.kind) {
    case 'OWNER_ONLY':
    case 'PUBLIC':
      return []
    case 'GROUPS':
      return scope.groupIds.map((id) => ({ id, label: catalogs.groupsById.get(id) ?? id }))
    case 'TIERS':
      return scope.tierIds.map((id) => ({ id, label: catalogs.tiersById.get(id) ?? id }))
    case 'USERS':
      return scope.userIds.map((id) => ({ id, label: catalogs.membersById.get(id) ?? id }))
  }
}

function writeAccessLabel(kind: WriteAccessKind): string {
  switch (kind) {
    case 'OWNER_ONLY':
      return 'Solo el owner'
    case 'GROUPS':
      return 'Grupos seleccionados'
    case 'TIERS':
      return 'Tiers seleccionados'
    case 'USERS':
      return 'Personas seleccionadas'
  }
}

function writeAccessHint(kind: WriteAccessKind): string {
  switch (kind) {
    case 'OWNER_ONLY':
      return 'Sólo vos (owner) podés crear contenido en esta categoría.'
    case 'GROUPS':
      return 'Sólo miembros de los grupos listados pueden crear contenido.'
    case 'TIERS':
      return 'Sólo miembros con tier activo listado pueden crear contenido.'
    case 'USERS':
      return 'Sólo las personas listadas pueden crear contenido.'
  }
}

function readAccessLabel(kind: LibraryReadAccessKind): string {
  switch (kind) {
    case 'PUBLIC':
      return 'Cualquier miembro'
    case 'GROUPS':
      return 'Grupos seleccionados'
    case 'TIERS':
      return 'Tiers seleccionados'
    case 'USERS':
      return 'Personas seleccionadas'
  }
}

function readAccessHint(kind: LibraryReadAccessKind): string {
  switch (kind) {
    case 'PUBLIC':
      return 'Cualquier miembro activo del place puede ver el contenido.'
    case 'GROUPS':
      return 'Sólo miembros de los grupos listados pueden ver el contenido.'
    case 'TIERS':
      return 'Sólo miembros con tier activo listado pueden ver el contenido.'
    case 'USERS':
      return 'Sólo las personas listadas pueden ver el contenido.'
  }
}
