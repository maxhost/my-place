'use client'

import { Check, Settings } from 'lucide-react'
import type { MyPlace } from '@/features/places/public'
import { placeUrl } from '@/shared/lib/app-url'
import { hashToIndex } from '@/shared/ui/avatar'

/**
 * Fila individual del dropdown del community switcher.
 *
 * Avatar 38×38 con color determinístico por slug — paleta local de 6
 * tonos warm distintos a la member palette (que viven en otro registro
 * visual). El handoff sugería derivar el color del `themeConfig.accent`
 * del place; queda como follow-up en R.2.2 para no extender el query
 * `listMyPlaces` en R.2.1.
 *
 * Si la fila representa el current place (`isCurrent=true`), tiene
 * `bg-accent-soft` y un check 20×20 a la derecha. Click en current
 * place es no-op (caller maneja).
 *
 * Si el viewer es admin/owner del place, aparece un icon Gear a la
 * derecha (antes del Check si aplica) que navega cross-subdomain al
 * panel de settings del place. Visible sólo para quien puede entrar
 * al panel — coherente con el gate del page (`/settings/`).
 *
 * Ver `docs/features/shell/spec.md` § 5 (lista del dropdown).
 */
type Props = {
  place: MyPlace
  isCurrent: boolean
  onSelect: (slug: string) => void
}

const COMMUNITY_PALETTE: ReadonlyArray<string> = [
  '#b5633a', // warm-brown (accent)
  '#7a8c5a', // sage
  '#4f6b85', // dusty-blue
  '#8b6aa3', // muted-purple
  '#b08a3e', // ochre
  '#5e7d6f', // moss
] as const

export function CommunityRow({ place, isCurrent, onSelect }: Props): React.ReactNode {
  const initial = (place.name.trim()[0] ?? '?').toUpperCase()
  const color = COMMUNITY_PALETTE[hashToIndex(place.slug, COMMUNITY_PALETTE.length)]
  const roleLabel = place.isOwner ? 'Owner' : place.isAdmin ? 'Admin' : 'Miembro'
  const showSettingsLink = place.isAdmin || place.isOwner

  // El row es un contenedor `div` (no `button`) porque el icon Gear
  // necesita ser un `<a>` cliqueable independiente — un button anidado
  // dentro de un button rompe HTML semántica + accessibility tree.
  // El área principal es un `button` que ocupa todo el espacio menos
  // el gear; éste vive como sibling con `stopPropagation` defensivo.
  return (
    <div
      role="menuitem"
      aria-current={isCurrent ? 'true' : undefined}
      className={[
        'flex w-full items-center gap-1 rounded-[10px] motion-safe:transition-colors',
        isCurrent ? 'bg-accent-soft' : 'hover:bg-soft',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={() => onSelect(place.slug)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-[10px] px-3 py-2 text-left"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] font-body text-base font-semibold text-bg"
          style={{ backgroundColor: color }}
        >
          {initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-body text-[15px] font-semibold tracking-tight text-text">
            {place.name}
          </span>
          <span className="block truncate font-body text-xs text-muted">{roleLabel}</span>
        </span>
        {isCurrent ? (
          <span
            aria-hidden="true"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-bg"
          >
            <Check size={12} />
          </span>
        ) : null}
      </button>
      {showSettingsLink ? (
        <a
          href={placeUrl(place.slug, '/settings').toString()}
          aria-label={`Configuración de ${place.name}`}
          title="Configuración"
          onClick={(e) => e.stopPropagation()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text motion-safe:transition-colors"
        >
          <Settings size={16} aria-hidden="true" />
        </a>
      ) : null}
    </div>
  )
}
