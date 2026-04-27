'use client'

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'

/**
 * Floating Action Button (R.2.6) — primitivo agnóstico al dominio.
 *
 * Trigger circular 56×56 fixed bottom-right de la columna del shell
 * (no de la viewport). Click abre un menú contextual via Radix
 * DropdownMenu (focus trap + ARIA + ESC + Portal nativos).
 *
 * Specs visuales (alineados con cozytech, ver spec § 17.3):
 *  - 56×56 (`h-14 w-14`), `rounded-full`.
 *  - `bg-surface` (NO accent — "presencia silenciosa").
 *  - Border 0.5px + sombra dual sutil idéntica a `<PageIcon>`.
 *  - Hover `bg-soft`; focus-visible ring accent.
 *  - Sin animación de entrada, sin pulse, sin badges.
 *
 * Posicionamiento desktop-aware (gap descubierto en audit, ver spec
 * § 17.4):
 *  - `right: max(12px, calc(50vw - 198px))` ancla el FAB al borde
 *    derecho de la columna `max-w-[420px]` del shell, no al borde de
 *    la viewport. Math: column right edge = 50vw + 210px; inset 12px
 *    desde ahí = `50vw - 198px` desde el right de la viewport.
 *    `max(12px, …)` garantiza que en mobile (viewport < 420px) el FAB
 *    queda a 12px del borde absoluto.
 *  - `bottom: calc(24px + env(safe-area-inset-bottom, 0px))` para iOS
 *    notch / home bar.
 *  - Z-index 30 (mismo nivel TopBar, sin colisión por posición).
 *  - Menú abierto z-50 vía DropdownMenuContent Portal.
 *
 * Items del menú vienen como `children` — el caller compone con
 * `<DropdownMenuItem asChild><Link>...</Link></DropdownMenuItem>`.
 * `asChild` del trigger apunta directo al `<button>` (no a un wrapper)
 * para que las props ARIA de Radix (haspopup, expanded, controls) se
 * apliquen en el elemento semántico correcto.
 *
 * Ver `docs/features/shell/spec.md` § 17 + ADR
 * `docs/decisions/2026-04-26-zone-fab.md`.
 */
type Props = {
  icon: React.ReactNode
  triggerLabel: string
  children: React.ReactNode
}

const SHADOW = '0 4px 14px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)'

export function FAB({ icon, triggerLabel, children }: Props): React.ReactNode {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          style={{ boxShadow: SHADOW }}
          // Tailwind arbitrary values para `right` y `bottom`:
          // - `right-[max(12px,calc(50vw_-_198px))]` ancla al borde
          //   derecho de la columna max-w-[420px] del shell.
          // - `bottom-[calc(24px+env(safe-area-inset-bottom,0px))]`
          //   respeta notch/home bar de iOS.
          // (Underscores reemplazan spaces dentro de [...] de Tailwind.)
          className="focus-visible:ring-accent/50 fixed bottom-[calc(24px+env(safe-area-inset-bottom,0px))] right-[max(12px,calc(50vw_-_198px))] z-30 inline-flex h-14 w-14 items-center justify-center rounded-full border-[0.5px] border-border bg-surface text-text hover:bg-soft focus-visible:outline-none focus-visible:ring-2 motion-safe:transition-colors"
        >
          {icon}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
