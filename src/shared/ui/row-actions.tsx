'use client'

import { useState, type ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog'

/**
 * `<RowActions>` — primitive responsive de acciones por-row.
 *
 * Resuelve dos UX patterns canónicos según viewport:
 *
 * - **Mobile**: chip-as-dropdown-trigger. El children es el contenido
 *   visible del chip y se envuelve en un `<DropdownMenuTrigger>`. Tap
 *   abre dropdown con las acciones como items textuales. Patrón
 *   canonizado en `docs/ux-patterns.md` § "Per-item dropdown menus".
 *
 * - **Desktop**: chip + icon buttons inline. El children es display-only
 *   (span no clickeable) y los icons se renderean al lado como buttons
 *   con aria-label. Más density (admin que pasa horas en settings),
 *   menos clicks (1 vs 2 del dropdown).
 *
 * - **Overflow (>3 actions)**: ambos viewports usan kebab (3-dots) en
 *   lugar de chip-as-trigger (>3 icons inline harían chips más anchos
 *   que el viewport mobile, y desktop perdería claridad visual).
 *
 * **Sin `useMediaQuery`**: switching mobile/desktop es CSS-driven via
 * `md:hidden` / `hidden md:inline-flex`. Ambos modes están en el DOM,
 * el viewport decide cuál se ve.
 *
 * **Touch targets**: todos los buttons (kebab, icons desktop) tienen
 * `min-h-11 min-w-11` (44px) per `ux-patterns.md` § "Touch target minimums".
 *
 * **Destructive ⇒ confirm dialog** (contrato fuerte): cualquier action con
 * `destructive: true` NO ejecuta `onSelect` directo. Abre un Dialog modal
 * con Cancelar/Sí, eliminar. Garantiza el principio "toda acción
 * destructiva requiere confirmación" sin que cada callsite tenga que
 * implementarlo. Customizable vía `confirmTitle`, `confirmDescription`,
 * `confirmActionLabel`.
 *
 * Ver `docs/research/2026-05-10-settings-desktop-ux-research.md` § "Per-row
 * actions desktop" y `docs/plans/2026-05-10-settings-desktop-redesign.md`
 * § "Sesión 4".
 */

export type RowAction = {
  /** Icono visible en desktop hover icons. Mobile dropdown solo muestra label. */
  icon: ReactNode
  /** Texto visible en mobile dropdown item + aria-label en desktop button. */
  label: string
  onSelect: () => void
  /**
   * Action destructiva (eliminar, archivar). Aplica `text-red-600` en desktop
   * + variantes `hover:bg-red-50`. En mobile dropdown, lo aplica al item.
   *
   * **Contrato fuerte:** cuando `true`, el `onSelect` NO se invoca directo —
   * se abre un Dialog confirm primero. Solo si el user confirma se ejecuta.
   */
  destructive?: boolean
  /**
   * Título del confirm dialog (solo aplica si `destructive: true`).
   * Default: `¿{label}?` (ej. "¿Eliminar?").
   */
  confirmTitle?: string
  /**
   * Descripción del confirm dialog (solo aplica si `destructive: true`).
   * Default: "Esta acción no se puede deshacer."
   */
  confirmDescription?: string
  /**
   * Label del botón confirmar (solo aplica si `destructive: true`).
   * Default: `Sí, ${label.toLowerCase()}` (ej. "Sí, eliminar").
   */
  confirmActionLabel?: string
}

type Props = {
  actions: RowAction[]
  /** aria-label del dropdown trigger (mobile chip-as-trigger o kebab overflow). */
  triggerLabel: string
  /**
   * Contenido visible del chip. NO un `<button>` — el primitive aplica el
   * wrapping (button mobile como dropdown trigger, span desktop con icons
   * al lado). Misma apariencia visual en ambos modos.
   */
  children: ReactNode
  /**
   * ClassName del chip — aplicado al button mobile y al span desktop por igual,
   * para que el chip se vea idéntico en ambos viewports.
   */
  chipClassName?: string
}

/**
 * Threshold para overflow mode: con >3 actions, ambos viewports cambian a
 * kebab fallback. Razón: 4+ icons inline desktop pierden claridad y rompen
 * el chip mobile (chips más anchos que viewport 360px).
 */
const OVERFLOW_THRESHOLD = 3

export function RowActions({ actions, triggerLabel, children, chipClassName = '' }: Props) {
  // Action pendiente de confirmación. null = no hay dialog abierto.
  // El dispatch al confirm dialog ocurre acá (en el root) para que un solo
  // Dialog cubra ambos modes (Inline + Overflow) sin duplicar state.
  const [pendingAction, setPendingAction] = useState<RowAction | null>(null)

  function handleSelect(action: RowAction) {
    if (action.destructive) {
      // No ejecutar `onSelect` directo: abrir confirm dialog primero.
      // El user todavía puede cancelar antes de que la acción ocurra.
      setPendingAction(action)
    } else {
      action.onSelect()
    }
  }

  function handleConfirm() {
    if (pendingAction) {
      pendingAction.onSelect()
      setPendingAction(null)
    }
  }

  function handleCancel() {
    setPendingAction(null)
  }

  const isOverflow = actions.length > OVERFLOW_THRESHOLD

  return (
    <>
      {isOverflow ? (
        <OverflowMode
          actions={actions}
          triggerLabel={triggerLabel}
          chipClassName={chipClassName}
          onSelect={handleSelect}
        >
          {children}
        </OverflowMode>
      ) : (
        <InlineMode
          actions={actions}
          triggerLabel={triggerLabel}
          chipClassName={chipClassName}
          onSelect={handleSelect}
        >
          {children}
        </InlineMode>
      )}

      <ConfirmDialog action={pendingAction} onConfirm={handleConfirm} onCancel={handleCancel} />
    </>
  )
}

type ModeProps = Props & {
  onSelect: (action: RowAction) => void
}

/** Mode 1-3 actions: chip-as-trigger mobile + chip+icons desktop. */
function InlineMode({ actions, triggerLabel, children, chipClassName, onSelect }: ModeProps) {
  return (
    <>
      {/* Mobile: chip ES el dropdown trigger */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={triggerLabel} className={`md:hidden ${chipClassName}`}>
            {children}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {actions.map((a, i) => (
            <DropdownMenuItem
              key={i}
              onSelect={() => onSelect(a)}
              className={a.destructive ? 'text-red-600' : ''}
            >
              {a.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Desktop: chip display-only + icon buttons inline */}
      <div className="hidden md:inline-flex md:items-center md:gap-1">
        <span className={chipClassName}>{children}</span>
        {actions.map((a, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(a)}
            aria-label={a.label}
            className={iconButtonClass(a.destructive)}
          >
            {a.icon}
          </button>
        ))}
      </div>
    </>
  )
}

/** Mode >3 actions: chip + kebab dropdown en ambos viewports. */
function OverflowMode({ actions, triggerLabel, children, chipClassName, onSelect }: ModeProps) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className={chipClassName}>{children}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={triggerLabel}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100"
          >
            <KebabIcon />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {actions.map((a, i) => (
            <DropdownMenuItem
              key={i}
              onSelect={() => onSelect(a)}
              className={a.destructive ? 'text-red-600' : ''}
            >
              {a.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * Confirm dialog para acciones destructivas. Se abre cuando `action !== null`.
 * Focus default en "Cancelar" (convención HIG — destructive nunca default).
 *
 * Copy: por default usa el label de la action ("¿Eliminar?" + "Sí, eliminar").
 * El callsite puede overridear cualquiera de los 3 campos para context-specific
 * messaging (ej. "¿Eliminar ventana 09:00–17:00 del Lunes?").
 */
function ConfirmDialog({
  action,
  onConfirm,
  onCancel,
}: {
  action: RowAction | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const open = action !== null
  const title = action?.confirmTitle ?? `¿${action?.label ?? 'Confirmar'}?`
  const description = action?.confirmDescription ?? 'Esta acción no se puede deshacer.'
  const actionLabel =
    action?.confirmActionLabel ?? `Sí, ${(action?.label ?? 'confirmar').toLowerCase()}`

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Radix dispara onOpenChange(false) en ESC / click outside / X.
        // Tratamos cualquier cierre que NO sea el botón Confirmar como Cancel.
        if (!next) onCancel()
      }}
    >
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-300 px-4 text-sm"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-red-600 bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700"
          >
            {actionLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function iconButtonClass(destructive?: boolean): string {
  const base =
    'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md transition-colors'
  return destructive
    ? `${base} text-red-600 hover:bg-red-50`
    : `${base} text-neutral-600 hover:bg-neutral-100`
}

function KebabIcon() {
  return (
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
  )
}
