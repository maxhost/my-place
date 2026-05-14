'use client'

import { Pencil } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { formatPrice } from '@/shared/lib/format-price'
import { tierDurationLabel } from '@/features/tiers/public'
import type { Tier, TierVisibility } from '@/features/tiers/public'

type Props = {
  tier: Tier
  effectiveVisibility: TierVisibility
  hasPendingChange: boolean
  disabled: boolean
  onSelect: () => void
  onEdit: () => void
  onToggleVisibility: (next: TierVisibility) => void
}

/**
 * Row tappable de un tier en `/settings/tiers`.
 *
 * El área principal (nombre, chip, precio·duración, descripción) es un
 * `<button>` que dispara `onSelect` → abre el `<TierDetailPanel>`. El
 * kebab y el switch viven como siblings fuera del button para que su tap
 * NO propague al detail (canónico para detail-from-list rows con sub-controls).
 *
 * Switch: PUBLISHED → ON (negro), HIDDEN → OFF (gris). Tap solo emite
 * `onToggleVisibility` con el `next` derivado; el parent decide si lo
 * guarda en pending state o persiste inmediato (save manual, S6).
 *
 * Chip + dot pending indicator viven adentro del button para que sean
 * parte visual de la row pero no interfieran con el click — un solo
 * tap-target ahí adentro.
 */
export function TierCard({
  tier,
  effectiveVisibility,
  hasPendingChange,
  disabled,
  onSelect,
  onEdit,
  onToggleVisibility,
}: Props): React.ReactNode {
  const isPublished = effectiveVisibility === 'PUBLISHED'
  const targetVisibility: TierVisibility = isPublished ? 'HIDDEN' : 'PUBLISHED'

  const chipClass = isPublished
    ? 'rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600'
    : 'rounded-full border border-amber-300 px-2 py-0.5 text-[11px] text-amber-700'
  const chipLabel = isPublished ? 'Publicado' : 'Oculto'

  return (
    <div className="overflow-hidden rounded-md border border-neutral-200">
      <div className="flex min-h-[56px] items-stretch gap-2">
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-3 text-left hover:bg-neutral-50"
          aria-label={`Ver detalle del tier ${tier.name}`}
        >
          <div className="min-w-0 flex-1 space-y-1">
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
            <p className="text-xs text-neutral-600">
              <span>{formatPrice(tier.priceCents, tier.currency)}</span>
              <span className="mx-1.5">·</span>
              <span>{tierDurationLabel(tier.duration)}</span>
            </p>
            {tier.description ? (
              <p className="line-clamp-2 text-xs text-neutral-600">{tier.description}</p>
            ) : null}
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1 pr-3">
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
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil aria-hidden="true" className="mr-2 h-4 w-4" />
                Editar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <TierVisibilitySwitch
            tierName={tier.name}
            isPublished={isPublished}
            disabled={disabled}
            onToggle={() => onToggleVisibility(targetVisibility)}
          />
        </div>
      </div>
    </div>
  )
}

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
