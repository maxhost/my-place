'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/shared/ui/toaster'
import { reviewFlagAction } from '@/features/flags/public'
import type { FlagView } from '@/features/flags/public'
import { FlagDetailPanel } from './flag-detail-panel'
import { FlagRow } from './flag-row'
import { FlagsPagination } from './flags-pagination'
import { TabChip } from './tab-chip'
import { TargetTypeFilter, type TargetTypeFilterValue } from './target-type-filter'

type Tab = 'pending' | 'resolved'

type Props = {
  placeSlug: string
  tab: Tab
  targetType: TargetTypeFilterValue
  views: ReadonlyArray<FlagView>
  /** Hrefs precomputados server-side (funciones no se pueden serializar
   *  Server → Client; ver fix `023eff9` en members admin). */
  hrefs: {
    pendingTab: string
    resolvedTab: string
    typeFilters: Record<TargetTypeFilterValue, string>
    nextPage: string | null
  }
}

type SheetState = { kind: 'closed' } | { kind: 'detail'; flagId: string }

/**
 * Orquestador admin de `/settings/flags` — patrón canónico detail-from-list
 * (mirror simplificado de `<MembersAdminPanel>`; state machine sólo
 * `closed | detail`, sin invite ni sub-sheets).
 *
 * Tabs Pendientes / Resueltos URL-based + filter chips de targetType
 * (Todos / Posts / Comentarios / Eventos) también URL-based. Click en una
 * row abre el `<FlagDetailPanel>` con preview completo + acciones de
 * moderación en el footer.
 *
 * Row kebab (solo OPEN) ofrece atajos directos:
 *  - Ver en contexto (link out al post/comment).
 *  - Ignorar (no-confirm).
 *  - Eliminar (destructive con confirm dialog del primitive RowActions).
 *
 * Post-review (success): `router.refresh()` para re-fetch del RSC payload
 * client-side (la action ya hace `revalidatePath`, el refresh dispara el
 * re-render inmediato). Sin esto, el item revisado quedaría visible como
 * OPEN hasta navegación manual.
 */
export function FlagsAdminPanel({
  placeSlug: _placeSlug,
  tab,
  targetType,
  views,
  hrefs,
}: Props): React.ReactNode {
  const router = useRouter()
  const [sheet, setSheet] = useState<SheetState>({ kind: 'closed' })
  const [, startReview] = useTransition()

  function close(): void {
    setSheet({ kind: 'closed' })
  }

  const detailView =
    sheet.kind === 'detail' ? (views.find((v) => v.id === sheet.flagId) ?? null) : null

  function handleQuickReview(view: FlagView, kind: 'dismiss' | 'delete'): void {
    startReview(async () => {
      try {
        if (kind === 'dismiss') {
          await reviewFlagAction({ flagId: view.id, decision: 'REVIEWED_DISMISSED' })
          toast.success('Reporte ignorado.')
        } else {
          await reviewFlagAction({
            flagId: view.id,
            decision: 'REVIEWED_ACTIONED',
            sideEffect: 'DELETE_TARGET',
          })
          toast.success(view.targetType === 'COMMENT' ? 'Comentario eliminado.' : 'Post eliminado.')
        }
        router.refresh()
      } catch {
        toast.error('No pudimos aplicar la revisión. Reintentá en un momento.')
      }
    })
  }

  return (
    <section aria-labelledby="flags-list-heading" className="space-y-3">
      <div>
        <h2
          id="flags-list-heading"
          className="border-b pb-2 font-serif text-xl"
          style={{ borderColor: 'var(--border)' }}
        >
          {tab === 'pending' ? 'Reportes pendientes' : 'Reportes resueltos'}
        </h2>
        <p className="mt-1 text-xs text-neutral-600">
          {tab === 'pending'
            ? 'Revisá los reportes para tomar acción o ignorarlos.'
            : 'Histórico de reportes ya procesados.'}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <TabChip href={hrefs.pendingTab} active={tab === 'pending'} label="Pendientes" />
        <TabChip href={hrefs.resolvedTab} active={tab === 'resolved'} label="Resueltos" />
      </div>

      <TargetTypeFilter active={targetType} hrefs={hrefs.typeFilters} />

      {views.length === 0 ? (
        <p className="rounded-md border border-neutral-200 bg-neutral-50 p-6 text-sm italic text-neutral-500">
          {emptyStateCopy(tab, targetType)}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
          {views.map((view) => {
            const isOpen = view.status === 'OPEN'
            const canDelete =
              isOpen && view.contentStatus !== 'DELETED' && view.targetType !== 'EVENT'
            return (
              <FlagRow
                key={view.id}
                view={view}
                onSelect={() => setSheet({ kind: 'detail', flagId: view.id })}
                onDismiss={isOpen ? () => handleQuickReview(view, 'dismiss') : null}
                onDelete={canDelete ? () => handleQuickReview(view, 'delete') : null}
              />
            )
          })}
        </ul>
      )}

      <FlagsPagination itemsInPage={views.length} nextHref={hrefs.nextPage} />

      <FlagDetailPanel
        open={sheet.kind === 'detail'}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        view={detailView}
        onAfterReview={close}
      />
    </section>
  )
}

function emptyStateCopy(tab: Tab, targetType: TargetTypeFilterValue): string {
  if (tab === 'pending') {
    return targetType === 'all'
      ? 'No hay reportes pendientes.'
      : 'No hay reportes pendientes para este tipo de contenido.'
  }
  return targetType === 'all'
    ? 'No hay reportes resueltos todavía.'
    : 'No hay reportes resueltos para este tipo de contenido.'
}
