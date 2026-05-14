'use client'

import { useEffect, useState, useTransition } from 'react'
import { toast } from '@/shared/ui/toaster'
import { setTierVisibilityAction } from '@/features/tiers/public'
import type { Tier, TierCurrency, TierDuration, TierVisibility } from '@/features/tiers/public'
import { friendlyTierErrorMessage } from './errors'
import { TierCard } from './tier-card'
import { TierDetailPanel } from './tier-detail-panel'
import { TierFormSheet } from './tier-form-sheet'

type Props = {
  placeSlug: string
  tiers: ReadonlyArray<Tier>
}

type SheetState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'detail'; tierId: string }
  | {
      kind: 'edit'
      tierId: string
      /** Determina al cerrar si volvemos al detail (cuando entró desde ahí)
       *  o al listing (cuando entró por el kebab). */
      returnTo: 'closed' | 'detail'
      initialName: string
      initialDescription: string | null
      initialPriceCents: number
      initialCurrency: TierCurrency
      initialDuration: TierDuration
    }

/**
 * Listado + orquestador de overlays para `/settings/tiers`.
 *
 * Detail-from-list (`docs/ux-patterns.md`): row tappable → `<TierDetailPanel>`
 * read-only; kebab y switch viven fuera del button principal para que su
 * tap no abra el detail.
 *
 * Save model — todo manual (S6, 2026-05-13): el switch solo registra
 * pending changes en state local; el botón page-level "Guardar cambios"
 * persiste todos via `Promise.allSettled` (parciales se mantienen en
 * pending para retry). Edit individual sigue con submit propio en el sheet.
 */
export function TiersListAdmin({ placeSlug, tiers }: Props): React.ReactNode {
  const [sheet, setSheet] = useState<SheetState>({ kind: 'closed' })
  const [pendingChanges, setPendingChanges] = useState<Map<string, TierVisibility>>(new Map())
  const [savingAll, startSavingAll] = useTransition()

  const isDirty = pendingChanges.size > 0

  function close(): void {
    setSheet((current) => {
      if (current.kind === 'edit' && current.returnTo === 'detail') {
        return { kind: 'detail', tierId: current.tierId }
      }
      return { kind: 'closed' }
    })
  }

  function openEditFromList(tier: Tier): void {
    setSheet({
      kind: 'edit',
      tierId: tier.id,
      returnTo: 'closed',
      initialName: tier.name,
      initialDescription: tier.description,
      initialPriceCents: tier.priceCents,
      initialCurrency: tier.currency,
      initialDuration: tier.duration,
    })
  }

  function openEditFromDetail(tier: Tier): void {
    setSheet({
      kind: 'edit',
      tierId: tier.id,
      returnTo: 'detail',
      initialName: tier.name,
      initialDescription: tier.description,
      initialPriceCents: tier.priceCents,
      initialCurrency: tier.currency,
      initialDuration: tier.duration,
    })
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

  const detailTier =
    sheet.kind === 'detail' ? (tiers.find((t) => t.id === sheet.tierId) ?? null) : null

  // Latch del último edit mode → preserva Radix Presence exit anim.
  type LatchedEditMode = {
    kind: 'edit'
    tierId: string
    initialName: string
    initialDescription: string | null
    initialPriceCents: number
    initialCurrency: TierCurrency
    initialDuration: TierDuration
  }
  const [latchedEditMode, setLatchedEditMode] = useState<LatchedEditMode | null>(null)
  useEffect(() => {
    if (sheet.kind === 'edit') {
      setLatchedEditMode({
        kind: 'edit',
        tierId: sheet.tierId,
        initialName: sheet.initialName,
        initialDescription: sheet.initialDescription,
        initialPriceCents: sheet.initialPriceCents,
        initialCurrency: sheet.initialCurrency,
        initialDuration: sheet.initialDuration,
      })
    }
  }, [sheet])

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
                onSelect={() => setSheet({ kind: 'detail', tierId: tier.id })}
                onEdit={() => openEditFromList(tier)}
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

      <TierDetailPanel
        open={sheet.kind === 'detail'}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        tier={detailTier}
        pendingVisibility={detailTier ? (pendingChanges.get(detailTier.id) ?? null) : null}
        onEdit={() => {
          if (detailTier) openEditFromDetail(detailTier)
        }}
      />

      <TierFormSheet
        open={sheet.kind === 'create'}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        mode={{ kind: 'create', placeSlug }}
      />

      {latchedEditMode ? (
        <TierFormSheet
          open={sheet.kind === 'edit'}
          onOpenChange={(next) => {
            if (!next) close()
          }}
          mode={latchedEditMode}
        />
      ) : null}
    </section>
  )
}
