'use client'

import { Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  EditPanel,
  EditPanelBody,
  EditPanelContent,
  EditPanelFooter,
  EditPanelHeader,
  EditPanelTitle,
} from '@/shared/ui/edit-panel'
import { formatPrice } from '@/shared/lib/format-price'
import { tierDurationLabel } from '@/features/tiers/public'
import type { Tier, TierVisibility } from '@/features/tiers/public'

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  /**
   * Tier a mostrar. `null` cuando el panel está cerrado y nunca se abrió.
   * Internamente latcheamos el último valor non-null para que el contenido
   * sobreviva la animación de cierre (Radix Presence necesita el subtree
   * presente para animar el exit — si el parent desmonta vía
   * `{tier ? ... : null}`, la animation se skipea).
   */
  tier: Tier | null
  /**
   * Visibilidad efectiva — si el user tiene un cambio pendiente sin
   * guardar (toggle en la row), pasamos el valor pending para que el
   * panel refleje lo que el user ve en el listing. `null` ⇒ usar
   * `tier.visibility`.
   */
  pendingVisibility: TierVisibility | null
  onEdit: () => void
}

/**
 * Panel de detalle (read-only) de un tier.
 *
 * **Patrón canónico `detail-from-list`** (`docs/ux-patterns.md`): click en
 * la row de un tier abre este panel. EditPanel responsive: side drawer
 * desktop / bottom sheet mobile. Mirror del `<GroupDetailPanel>` y
 * `<CategoryDetailPanel>` (library) — única primitive UX para detail-from-list.
 *
 * Contenido:
 *  - Header: name + chip visibilidad (Publicado/Oculto) + dot pending si
 *    el user tiene un cambio sin guardar para este tier.
 *  - Sección "Precio" — formatPrice + duración label.
 *  - Sección "Descripción" — solo si existe.
 *  - Footer: "Editar" filled primary. v1 no tiene delete (tiers no se
 *    eliminan — se ocultan).
 *
 * Latch: preservamos last non-null `tier` para que Radix Presence anime el
 * exit del Content cuando `open` flipea a false.
 */
export function TierDetailPanel({
  open,
  onOpenChange,
  tier,
  pendingVisibility,
  onEdit,
}: Props): React.ReactNode {
  const [latched, setLatched] = useState<{
    tier: Tier
    pendingVisibility: TierVisibility | null
  } | null>(null)
  useEffect(() => {
    if (tier) setLatched({ tier, pendingVisibility })
  }, [tier, pendingVisibility])

  const displayTier = tier ?? latched?.tier ?? null
  const displayPending = tier ? pendingVisibility : (latched?.pendingVisibility ?? null)

  if (!displayTier) return null

  const effectiveVisibility = displayPending ?? displayTier.visibility
  const isPublished = effectiveVisibility === 'PUBLISHED'
  const chipClass = isPublished
    ? 'shrink-0 rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600'
    : 'shrink-0 rounded-full border border-amber-300 px-2 py-0.5 text-[11px] text-amber-700'
  const chipLabel = isPublished ? 'Publicado' : 'Oculto'
  const hasPending = displayPending !== null && displayPending !== displayTier.visibility

  return (
    <EditPanel open={open} onOpenChange={onOpenChange}>
      <EditPanelContent aria-describedby={undefined}>
        <EditPanelHeader>
          <EditPanelTitle>
            <span className="flex items-center gap-2">
              <span className="truncate">{displayTier.name}</span>
              <span className={chipClass}>{chipLabel}</span>
              {hasPending ? (
                <span
                  aria-label="Cambio sin guardar"
                  title="Cambio sin guardar"
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                />
              ) : null}
            </span>
          </EditPanelTitle>
        </EditPanelHeader>

        <EditPanelBody>
          <div className="space-y-5 py-2">
            <section className="space-y-2">
              <h3
                className="border-b pb-2 font-serif text-base"
                style={{ borderColor: 'var(--border)' }}
              >
                Precio
              </h3>
              <p className="text-sm text-neutral-700">
                <span className="font-medium">
                  {formatPrice(displayTier.priceCents, displayTier.currency)}
                </span>
                <span className="mx-1.5 text-neutral-400">·</span>
                <span>{tierDurationLabel(displayTier.duration)}</span>
              </p>
            </section>

            {displayTier.description ? (
              <section className="space-y-2">
                <h3
                  className="border-b pb-2 font-serif text-base"
                  style={{ borderColor: 'var(--border)' }}
                >
                  Descripción
                </h3>
                <p className="whitespace-pre-line text-sm text-neutral-700">
                  {displayTier.description}
                </p>
              </section>
            ) : null}

            <section className="space-y-2">
              <h3
                className="border-b pb-2 font-serif text-base"
                style={{ borderColor: 'var(--border)' }}
              >
                Visibilidad
              </h3>
              <p className="text-sm text-neutral-700">
                {isPublished
                  ? 'Visible para los miembros del place.'
                  : 'Oculto para los miembros. El owner lo sigue viendo en /settings/tiers.'}
              </p>
              {hasPending ? (
                <p className="text-xs italic text-amber-700">
                  Tenés un cambio sin guardar. Tocá “Guardar cambios” en el listado para
                  persistirlo.
                </p>
              ) : null}
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
        </EditPanelFooter>
      </EditPanelContent>
    </EditPanel>
  )
}
