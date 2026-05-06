'use client'

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { MyPlace } from '@/features/places/public'
import { placeUrl } from '@/shared/lib/app-url'
import { hashToIndex } from '@/shared/ui/avatar'
import { CommunityRow } from './community-row'

/**
 * Pill central de la TopBar (logo mini + nombre + chevron) que abre el
 * dropdown con la lista de places del viewer.
 *
 * Estados: closed | open. ESC y click en backdrop cierran. Selección
 * dispara cross-subdomain navigation via `window.location.assign`. La
 * cookie de sesión cross-subdomain ya está validada (apex domain
 * cookie) — el user mantiene su sesión al saltar de place.
 *
 * Click en el current place es no-op (cierra dropdown sin navegación).
 *
 * Ver `docs/features/shell/spec.md` § 5 (community switcher) y § 8 (a11y).
 */
type Props = {
  places: ReadonlyArray<MyPlace>
  currentSlug: string
}

const COMMUNITY_PALETTE: ReadonlyArray<string> = [
  '#b5633a',
  '#7a8c5a',
  '#4f6b85',
  '#8b6aa3',
  '#b08a3e',
  '#5e7d6f',
] as const

export function CommunitySwitcher({ places, currentSlug }: Props): React.ReactNode {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const current = places.find((p) => p.slug === currentSlug) ?? null
  const currentName = current?.name ?? currentSlug
  const currentInitial = (currentName.trim()[0] ?? '?').toUpperCase()
  const currentColor = COMMUNITY_PALETTE[hashToIndex(currentSlug, COMMUNITY_PALETTE.length)]

  function selectPlace(slug: string): void {
    if (slug === currentSlug) {
      setOpen(false)
      return
    }
    // Cross-subdomain navigation. Cookie de sesión cross-subdomain ya
    // está validada (apex domain). Va al "/" del nuevo place, no
    // replica el path actual.
    window.location.assign(placeUrl(slug).href)
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="community-dropdown"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[12px] border-[0.5px] border-border bg-surface px-2 hover:bg-soft motion-safe:transition-colors"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] font-body text-[11px] font-bold text-bg"
          style={{ backgroundColor: currentColor }}
        >
          {currentInitial}
        </span>
        <span className="min-w-0 flex-1 truncate text-left font-body text-[15px] font-semibold tracking-tight text-text">
          {currentName}
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={[
            'shrink-0 text-muted transition-transform duration-200',
            open ? 'rotate-180' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
      </button>

      {open ? (
        <>
          {/* Backdrop: tap cierra. No `role=dialog` porque el dropdown
              es un menú con scrim, no modal estricto. */}
          <button
            type="button"
            aria-label="Cerrar"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="motion-safe:animate-in motion-safe:fade-in fixed inset-0 z-40 bg-black/30 motion-safe:duration-200"
          />
          <div
            id="community-dropdown"
            role="menu"
            className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-3 fixed left-3 right-3 top-[52px] z-[41] mx-auto max-w-[400px] overflow-hidden rounded-[18px] border-[0.5px] border-border bg-surface shadow-lg motion-safe:duration-[220ms]"
          >
            <div className="px-4 pb-2 pt-3">
              <p className="font-body text-[11px] font-semibold uppercase tracking-wider text-muted">
                Tus comunidades
              </p>
            </div>
            <div className="max-h-[60vh] space-y-0.5 overflow-y-auto px-2 pb-2">
              {places.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-muted">
                  No tenés comunidades activas.
                </p>
              ) : (
                places.map((place) => (
                  <CommunityRow
                    key={place.slug}
                    place={place}
                    isCurrent={place.slug === currentSlug}
                    onSelect={selectPlace}
                  />
                ))
              )}
            </div>
            <div className="border-t-[0.5px] border-border px-4 py-3">
              <p
                aria-disabled="true"
                title="Próximamente"
                className="font-body text-sm text-muted opacity-60"
              >
                + Descubrir comunidades
              </p>
            </div>
          </div>
        </>
      ) : null}
    </>
  )
}
