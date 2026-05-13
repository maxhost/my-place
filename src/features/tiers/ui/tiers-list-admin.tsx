'use client'

import { useState, useTransition } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { toast } from '@/shared/ui/toaster'
import { formatPrice } from '@/shared/lib/format-price'
import { setTierVisibilityAction, tierDurationLabel } from '@/features/tiers/public'
import type { Tier, TierCurrency, TierDuration, TierVisibility } from '@/features/tiers/public'
import { friendlyTierErrorMessage } from './errors'
import { TierFormSheet } from './tier-form-sheet'

type Props = {
  placeSlug: string
  tiers: ReadonlyArray<Tier>
}

type SheetState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | {
      kind: 'edit'
      tierId: string
      initialName: string
      initialDescription: string | null
      initialPriceCents: number
      initialCurrency: TierCurrency
      initialDuration: TierDuration
    }

/**
 * Listado + orquestador de overlays para `/settings/tiers`.
 *
 * **Save model — todo manual (S6, 2026-05-13):**
 *
 * El switch de visibility (PUBLISHED ↔ HIDDEN) en cada row NO ejecuta
 * action inmediato — solo registra el cambio en state local
 * (`pendingChanges` Map). El user persiste TODOS los cambios pendientes
 * con UN tap en el botón "Guardar cambios" page-level. Patrón alineado
 * con `/settings/editor` y `/settings/hours` ("todo manual",
 * `docs/ux-patterns.md` § "Save model").
 *
 * Edit individual via `<TierFormSheet>` sigue con su propio submit
 * (sheet-level "Listo" persiste solo ese tier). Solo el toggle de
 * visibility se acumula en pending — eso es lo que mutaba en single-tap
 * con la iteración previa.
 *
 * Si el bulk save falla en algún tier (e.g. `name_already_published`),
 * los exitosos se persisten + los fallidos quedan en pending para retry.
 * Toast con resumen del resultado.
 *
 * Iter previa (2026-05-12): switch del header disparaba
 * `setTierVisibilityAction` directo en `startTransition`. Migrado a
 * pending state por feedback user 2026-05-13.
 */
export function TiersListAdmin({ placeSlug, tiers }: Props): React.ReactNode {
  const [sheet, setSheet] = useState<SheetState>({ kind: 'closed' })
  const [pendingChanges, setPendingChanges] = useState<Map<string, TierVisibility>>(new Map())
  const [savingAll, startSavingAll] = useTransition()

  const isDirty = pendingChanges.size > 0

  function close(): void {
    setSheet({ kind: 'closed' })
  }

  function handleVisibilityToggle(tier: Tier, next: TierVisibility): void {
    setPendingChanges((prev) => {
      const m = new Map(prev)
      if (next === tier.visibility) {
        // Volver al valor original = sin cambio pendiente.
        m.delete(tier.id)
      } else {
        m.set(tier.id, next)
      }
      return m
    })
  }

  function handleSaveAll(): void {
    if (!isDirty || savingAll) return
    const entries = Array.from(pendingChanges.entries())
    startSavingAll(async () => {
      const results = await Promise.allSettled(
        entries.map(([tierId, visibility]) =>
          setTierVisibilityAction({ tierId, visibility }).catch((err) => {
            throw err
          }),
        ),
      )

      const failed: Array<{ tierName: string; reason: string }> = []
      let successCount = 0

      results.forEach((r, idx) => {
        const [tierId] = entries[idx]!
        const tier = tiers.find((t) => t.id === tierId)
        const tierName = tier?.name ?? tierId

        if (r.status === 'fulfilled') {
          if (r.value.ok) {
            successCount += 1
          } else {
            const reason =
              r.value.error === 'name_already_published'
                ? 'ya hay otro publicado con ese nombre'
                : 'error desconocido'
            failed.push({ tierName, reason })
          }
        } else {
          failed.push({ tierName, reason: friendlyTierErrorMessage(r.reason) })
        }
      })

      if (failed.length === 0) {
        toast.success(
          `${successCount} ${successCount === 1 ? 'tier guardado' : 'tiers guardados'}.`,
        )
        setPendingChanges(new Map())
      } else {
        const failedSummary = failed.map((f) => `${f.tierName} (${f.reason})`).join(', ')
        toast.error(
          successCount > 0
            ? `Guardados: ${successCount}. Falló: ${failedSummary}.`
            : `Falló: ${failedSummary}.`,
        )
        // Mantener en pending solo los fallidos.
        const failedIds = new Set(
          failed
            .map((f) => tiers.find((t) => t.name === f.tierName)?.id)
            .filter((x): x is string => Boolean(x)),
        )
        setPendingChanges((prev) => {
          const m = new Map<string, TierVisibility>()
          for (const [tierId, vis] of prev) {
            if (failedIds.has(tierId)) m.set(tierId, vis)
          }
          return m
        })
      }
    })
  }

  const formSheetOpen = sheet.kind === 'create' || sheet.kind === 'edit'
  const formSheetMode =
    sheet.kind === 'edit'
      ? {
          kind: 'edit' as const,
          tierId: sheet.tierId,
          initialName: sheet.initialName,
          initialDescription: sheet.initialDescription,
          initialPriceCents: sheet.initialPriceCents,
          initialCurrency: sheet.initialCurrency,
          initialDuration: sheet.initialDuration,
        }
      : { kind: 'create' as const, placeSlug }

  return (
    <section aria-labelledby="tiers-list-heading" className="space-y-3">
      <div>
        <h2
          id="tiers-list-heading"
          className="border-b pb-2 font-serif text-xl"
          style={{ borderColor: 'var(--border)' }}
        >
          Tiers
        </h2>
        <p className="mt-1 text-xs text-neutral-600">
          {tiers.length} {tiers.length === 1 ? 'tier' : 'tiers'} · los nuevos arrancan ocultos.
        </p>
      </div>

      {tiers.length === 0 ? (
        <p className="text-sm italic text-neutral-500">
          Todavía no hay tiers. Definí el primero para empezar a estructurar la membresía del place.
        </p>
      ) : (
        <div className="space-y-3">
          {tiers.map((tier) => {
            const pendingVisibility = pendingChanges.get(tier.id)
            const effectiveVisibility = pendingVisibility ?? tier.visibility
            return (
              <TierCard
                key={tier.id}
                tier={tier}
                effectiveVisibility={effectiveVisibility}
                hasPendingChange={pendingVisibility !== undefined}
                disabled={savingAll}
                onEdit={() =>
                  setSheet({
                    kind: 'edit',
                    tierId: tier.id,
                    initialName: tier.name,
                    initialDescription: tier.description,
                    initialPriceCents: tier.priceCents,
                    initialCurrency: tier.currency,
                    initialDuration: tier.duration,
                  })
                }
                onToggleVisibility={(next) => handleVisibilityToggle(tier, next)}
              />
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setSheet({ kind: 'create' })}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 px-4 text-sm font-medium text-neutral-600 hover:border-neutral-500"
      >
        <span aria-hidden="true">+</span> Nuevo tier
      </button>

      {/* Save bar page-level. Visible siempre; el botón se habilita cuando
          hay cambios pendientes. Mismo patrón que `<EditorConfigForm>`. */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <span
          aria-live="polite"
          className={
            isDirty && !savingAll ? 'text-xs text-neutral-500' : 'text-xs text-transparent'
          }
        >
          {isDirty && !savingAll
            ? `• ${pendingChanges.size} ${pendingChanges.size === 1 ? 'cambio sin guardar' : 'cambios sin guardar'}`
            : ' '}
        </span>
        <button
          type="button"
          onClick={handleSaveAll}
          disabled={!isDirty || savingAll}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-60"
        >
          {savingAll ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>

      <TierFormSheet
        open={formSheetOpen}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        mode={formSheetMode}
      />
    </section>
  )
}

// ---------------------------------------------------------------
// TierCard internal — card con header (nombre + meta + chip + 3-dots +
// switch). Switch ahora es controlled por effectiveVisibility +
// onToggleVisibility (NO ejecuta action inmediato).
// ---------------------------------------------------------------

type TierCardProps = {
  tier: Tier
  effectiveVisibility: TierVisibility
  hasPendingChange: boolean
  disabled: boolean
  onEdit: () => void
  onToggleVisibility: (next: TierVisibility) => void
}

function TierCard({
  tier,
  effectiveVisibility,
  hasPendingChange,
  disabled,
  onEdit,
  onToggleVisibility,
}: TierCardProps): React.ReactNode {
  const isPublished = effectiveVisibility === 'PUBLISHED'
  const targetVisibility: TierVisibility = isPublished ? 'HIDDEN' : 'PUBLISHED'

  // Chip canónico: neutral si publicado, amber si oculto. Si hay cambio
  // pendiente, sumamos un dot indicator entre el título y el chip para
  // que el user vea qué tiers están dirty antes de save.
  const chipClass = isPublished
    ? 'rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600'
    : 'rounded-full border border-amber-300 px-2 py-0.5 text-[11px] text-amber-700'
  const chipLabel = isPublished ? 'Publicado' : 'Oculto'

  return (
    <div className="rounded-md border border-neutral-200">
      <div
        className={`flex min-h-[56px] items-center gap-2 px-3 py-3 ${tier.description ? 'border-b border-neutral-200' : ''}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-serif text-base">{tier.name}</h3>
            <span className={chipClass}>{chipLabel}</span>
            {hasPendingChange ? (
              <span
                aria-label="Cambio sin guardar"
                title="Cambio sin guardar"
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
              />
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-neutral-600">
            <span>{formatPrice(tier.priceCents, tier.currency)}</span>
            <span className="mx-1.5">·</span>
            <span>{tierDurationLabel(tier.duration)}</span>
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100"
              aria-label={`Opciones para ${tier.name}`}
              disabled={disabled}
            >
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="5" r="1" />
                <circle cx="12" cy="12" r="1" />
                <circle cx="12" cy="19" r="1" />
              </svg>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onEdit}>Editar</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <TierVisibilitySwitch
          tierName={tier.name}
          isPublished={isPublished}
          disabled={disabled}
          onToggle={() => onToggleVisibility(targetVisibility)}
        />
      </div>

      {tier.description ? (
        <div className="px-3 py-2">
          <p className="line-clamp-2 text-xs text-neutral-600">{tier.description}</p>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Switch on/off para visibility del tier. PUBLISHED → ON (negro), HIDDEN
 * → OFF (gris). Tap solo emite `onToggle` — el parent decide si lo guarda
 * en pending state o persiste inmediato.
 */
function TierVisibilitySwitch({
  tierName,
  isPublished,
  disabled,
  onToggle,
}: {
  tierName: string
  isPublished: boolean
  disabled: boolean
  onToggle: () => void
}): React.ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isPublished}
      aria-label={`${tierName}: ${isPublished ? 'publicado, tocá para ocultar' : 'oculto, tocá para publicar'}`}
      disabled={disabled}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:cursor-not-allowed disabled:opacity-60 ${
        isPublished ? 'bg-neutral-900' : 'bg-neutral-300'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          isPublished ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
