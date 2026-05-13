'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { toast } from '@/shared/ui/toaster'
import { RowActions } from '@/shared/ui/row-actions'
import { isDomainError } from '@/shared/errors/domain-error'
import {
  archiveLibraryCategoryAction,
  friendlyLibraryErrorMessage,
  MAX_CATEGORIES_PER_PLACE,
  type LibraryCategory,
  type LibraryReadAccessKind,
  type WriteAccessKind,
} from '@/features/library/public'
import {
  CategoryFormSheet,
  type GroupOption,
  type MemberOption,
  type TierOption,
} from '@/features/library/wizard/public'
import { CategoryDetailPanel } from './category-detail-panel'

/**
 * Panel admin de categorías de biblioteca (S5, 2026-05-13).
 *
 * **Patrón canónico `detail-from-list`** (ver `docs/ux-patterns.md`):
 *  - Row entera tappable → abre `<CategoryDetailPanel>` (EditPanel:
 *    sidebar desktop / bottomsheet mobile).
 *  - Kebab 3-dots (RowActions con `forceOverflow`) ofrece atajos
 *    Editar (abre wizard) + Archivar (destructive con confirm).
 *  - Dashed-border "+ Nueva categoría" abajo del listado.
 *
 * El detalle es read-only — muestra emoji, slug, write/read access
 * desglosado con nombres legibles (groups + tiers + users), count
 * items, fechas. Los botones Editar/Archivar viven adentro del panel.
 *
 * Decisión user 2026-05-12: items NO se gestionan desde este admin
 * (viven en zona gated `/library/[cat]/[item]`).
 */

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

type Props = {
  placeId: string
  categories: ReadonlyArray<LibraryCategory>
  scopesByCategoryId: ReadonlyMap<string, CategoryScope>
  groups: ReadonlyArray<GroupOption>
  members: ReadonlyArray<MemberOption>
  tiers: ReadonlyArray<TierOption>
}

type SheetState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'detail'; categoryId: string }
  | { kind: 'edit'; categoryId: string }

export function LibraryCategoriesPanel({
  placeId,
  categories,
  scopesByCategoryId,
  groups,
  members,
  tiers,
}: Props): React.ReactNode {
  const [sheet, setSheet] = useState<SheetState>({ kind: 'closed' })
  const [pendingArchive, startArchive] = useTransition()

  const canCreateMore = categories.length < MAX_CATEGORIES_PER_PLACE

  // Lookup maps para resolver IDs a nombres legibles en el detalle.
  const groupsById = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups])
  const tiersById = useMemo(() => new Map(tiers.map((t) => [t.id, t.name])), [tiers])
  const membersById = useMemo(
    () =>
      new Map(
        members.map((m) => [
          m.userId,
          m.handle ? `${m.displayName} · @${m.handle}` : m.displayName,
        ]),
      ),
    [members],
  )

  function close(): void {
    setSheet({ kind: 'closed' })
  }

  function handleArchive(category: LibraryCategory): void {
    startArchive(async () => {
      try {
        await archiveLibraryCategoryAction({ categoryId: category.id })
        toast.success(`Categoría "${category.title}" archivada.`)
      } catch (err) {
        toast.error(isDomainError(err) ? friendlyLibraryErrorMessage(err) : 'No se pudo archivar.')
      }
    })
  }

  // Para detail: pasamos los props directamente, el panel se mantiene
  // siempre montado y latchea internamente el último valor non-null para
  // que Radix Presence anime el exit cuando `open` flipea a false.
  const detailCategory =
    sheet.kind === 'detail' ? (categories.find((c) => c.id === sheet.categoryId) ?? null) : null
  const detailScope =
    sheet.kind === 'detail' ? (scopesByCategoryId.get(sheet.categoryId) ?? null) : null

  const editingCategory =
    sheet.kind === 'edit' ? categories.find((c) => c.id === sheet.categoryId) : null
  const editingScope =
    sheet.kind === 'edit' ? (scopesByCategoryId.get(sheet.categoryId) ?? null) : null

  // Latch del último edit mode: mantiene `<CategoryFormSheet>` montado
  // (con el mode anterior) durante la animation de cierre para que Radix
  // Presence anime el exit. Mismo patrón que `<CategoryDetailPanel>`.
  const [latchedEditMode, setLatchedEditMode] = useState<{
    kind: 'edit'
    categoryId: string
    initialEmoji: string
    initialTitle: string
    initialKind: LibraryCategory['kind']
    initialWriteAccessKind: WriteAccessKind
    initialWriteGroupIds: ReadonlyArray<string>
    initialWriteTierIds: ReadonlyArray<string>
    initialWriteUserIds: ReadonlyArray<string>
    initialReadAccessKind: LibraryReadAccessKind
    initialReadGroupIds: ReadonlyArray<string>
    initialReadTierIds: ReadonlyArray<string>
    initialReadUserIds: ReadonlyArray<string>
  } | null>(null)
  useEffect(() => {
    if (editingCategory && editingScope) {
      setLatchedEditMode({
        kind: 'edit',
        categoryId: editingCategory.id,
        initialEmoji: editingCategory.emoji,
        initialTitle: editingCategory.title,
        initialKind: editingCategory.kind,
        initialWriteAccessKind: editingScope.write.kind,
        initialWriteGroupIds: editingScope.write.groupIds,
        initialWriteTierIds: editingScope.write.tierIds,
        initialWriteUserIds: editingScope.write.userIds,
        initialReadAccessKind: editingScope.read.kind,
        initialReadGroupIds: editingScope.read.groupIds,
        initialReadTierIds: editingScope.read.tierIds,
        initialReadUserIds: editingScope.read.userIds,
      })
    }
  }, [editingCategory, editingScope])

  return (
    <>
      <section aria-labelledby="library-categories-heading" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2
            id="library-categories-heading"
            className="flex-1 border-b pb-2 font-serif text-xl"
            style={{ borderColor: 'var(--border)' }}
          >
            Categorías
          </h2>
          <span className="text-xs text-neutral-600">
            {categories.length}
            {canCreateMore ? ` de ${MAX_CATEGORIES_PER_PLACE}` : ' — máximo'}
          </span>
        </div>

        {categories.length === 0 ? (
          <p className="rounded-md border border-neutral-200 bg-neutral-50 p-6 text-sm italic text-neutral-500">
            Todavía no hay categorías. Creá la primera para empezar a organizar la biblioteca.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
            {categories.map((c) => {
              return (
                <li key={c.id} className="flex min-h-[56px] items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSheet({ kind: 'detail', categoryId: c.id })}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left hover:bg-neutral-50"
                    aria-label={`Ver detalle de ${c.title}`}
                  >
                    <span aria-hidden className="text-2xl leading-none">
                      {c.emoji}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-serif text-base">{c.title}</h3>
                    </div>
                  </button>
                  <div className="shrink-0 pr-2">
                    <RowActions
                      triggerLabel={`Acciones para ${c.title}`}
                      chipClassName="hidden"
                      forceOverflow={true}
                      actions={[
                        {
                          icon: <Pencil aria-hidden="true" className="h-4 w-4" />,
                          label: 'Editar',
                          onSelect: () => setSheet({ kind: 'edit', categoryId: c.id }),
                        },
                        {
                          icon: <Trash2 aria-hidden="true" className="h-4 w-4" />,
                          label: 'Archivar',
                          destructive: true,
                          confirmTitle: `¿Archivar "${c.title}"?`,
                          confirmDescription:
                            'Los items existentes se mantienen pero la categoría se oculta del listado. Reversible desde la base de datos.',
                          confirmActionLabel: 'Sí, archivar',
                          onSelect: () => handleArchive(c),
                        },
                      ]}
                    >
                      <span aria-hidden />
                    </RowActions>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {canCreateMore ? (
          <button
            type="button"
            onClick={() => setSheet({ kind: 'create' })}
            disabled={pendingArchive}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 px-4 text-sm font-medium text-neutral-600 hover:border-neutral-500 disabled:opacity-60"
          >
            <span aria-hidden="true">+</span> Nueva categoría
          </button>
        ) : (
          <p className="text-xs italic text-neutral-500">
            Llegaste al máximo de {MAX_CATEGORIES_PER_PLACE} categorías. Archivá alguna para crear
            otra.
          </p>
        )}
      </section>

      <CategoryFormSheet
        open={sheet.kind === 'create'}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        mode={{ kind: 'create', placeId }}
        groups={groups}
        members={members}
        tiers={tiers}
      />

      <CategoryDetailPanel
        open={sheet.kind === 'detail'}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        category={detailCategory}
        scope={detailScope}
        groupsById={groupsById}
        tiersById={tiersById}
        membersById={membersById}
        onEdit={() => {
          if (detailCategory) setSheet({ kind: 'edit', categoryId: detailCategory.id })
        }}
        onArchive={() => {
          if (detailCategory) handleArchive(detailCategory)
        }}
      />

      {/* Edit wizard — siempre montado una vez que el user abrió un edit,
          con `mode` latcheado para que Radix Presence anime el exit
          cuando `open` flipea a false. */}
      {latchedEditMode ? (
        <CategoryFormSheet
          open={sheet.kind === 'edit'}
          onOpenChange={(next) => {
            if (!next) close()
          }}
          mode={latchedEditMode}
          groups={groups}
          members={members}
          tiers={tiers}
        />
      ) : null}
    </>
  )
}
