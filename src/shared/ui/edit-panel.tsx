'use client'

import * as RadixDialog from '@radix-ui/react-dialog'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

/**
 * Panel responsive de edit/add. Hereda mobile-first del `<BottomSheet>` y
 * extiende a desktop como side drawer (right slide-in 520px). UN solo
 * componente, dos layouts via clases CSS Tailwind — sin `useMediaQuery`,
 * sin hydration mismatch.
 *
 * **Cuándo usar:** forms con ≥2 inputs invocados desde una list/row en
 * `/settings/*`. En desktop, el side drawer mantiene visible la lista de
 * fondo (Smashing 2026 decision tree); en mobile, el bottom sheet ancla
 * los CTAs en thumb-zone.
 *
 * **Cuándo NO usar:** ver `<BottomSheet>` y `<Dialog>` para casos
 * (confirms, single-input prompts, full-page wizards).
 *
 * Mantiene la API estructural de `<BottomSheet>` (Header / Title /
 * Description / Body / Footer) para que migrar de uno a otro sea drop-in.
 *
 * Wraps Radix Dialog: focus trap, ESC, aria-modal, return focus, portal.
 *
 * Z-index: 50 (mismo que `<Dialog>` y `<BottomSheet>`). `<Toaster />` queda
 * en 60 — sigue siendo el top.
 *
 * **Animations (2026-05-12 v5):** patrón shadcn Sheet con `tailwindcss-animate`.
 * Las clases `data-[state=open]:animate-in / data-[state=closed]:animate-out`
 * aplican `animation-name: enter / exit` — distintos entre estados, lo que
 * permite a Radix Dialog Presence detectar el cambio y esperar al
 * `animationend` antes de unmount.
 *
 * Iteración previa con `forceMount` (v4) rompía el flow: dejaba el dialog
 * en DOM siempre, lo que (a) causaba flash visual al cargar la página
 * (slide-down keyframe ejecutaba con elemento inicialmente visible), y
 * (b) bloqueaba clicks porque Radix aplica `pointer-events: auto` como
 * inline style con mayor specificity que `data-[state=closed]:pointer-events-none`.
 *
 * Mobile (default): `slide-in-from-bottom / slide-out-to-bottom`.
 * Desktop (md:): override con `slide-in-from-right / slide-out-to-right` +
 * `slide-in-from-bottom-0 / slide-out-to-bottom-0` para neutralizar el
 * translateY del mobile.
 *
 * Ver `docs/research/2026-05-10-settings-desktop-ux-research.md` § "Edit
 * forms desktop" y `docs/plans/2026-05-10-settings-desktop-redesign.md`
 * § "Sesión 2".
 */

export const EditPanel = RadixDialog.Root
export const EditPanelTrigger = RadixDialog.Trigger
export const EditPanelPortal = RadixDialog.Portal
export const EditPanelClose = RadixDialog.Close

function EditPanelOverlay(props: ComponentPropsWithoutRef<typeof RadixDialog.Overlay>) {
  const { className = '', ...rest } = props
  return (
    <RadixDialog.Overlay
      className={`edit-panel-overlay fixed inset-0 z-50 bg-black/40 data-[state=closed]:duration-200 data-[state=open]:duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 ${className}`}
      {...rest}
    />
  )
}

type EditPanelContentProps = ComponentPropsWithoutRef<typeof RadixDialog.Content> & {
  children: ReactNode
}

/**
 * Container del panel.
 *
 * - **Mobile (default)**: anchored bottom, max-h 85vh, rounded-top, slide
 *   bottom → top abrir / top → bottom cerrar.
 * - **Desktop (`md:`)**: anchored right, full height, fixed width 520px,
 *   slide right → left abrir / left → right cerrar.
 *
 * Children deben estructurarse con `<EditPanelHeader>`, `<EditPanelBody>`,
 * `<EditPanelFooter>`.
 */
export function EditPanelContent({ children, className = '', ...rest }: EditPanelContentProps) {
  return (
    <EditPanelPortal>
      <EditPanelOverlay />
      <RadixDialog.Content
        className={`edit-panel-content fixed bottom-0 left-0 right-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border-t shadow-2xl outline-none data-[state=closed]:duration-200 data-[state=open]:duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom md:bottom-0 md:left-auto md:right-0 md:top-0 md:h-screen md:max-h-screen md:w-[520px] md:rounded-none md:border-l md:border-t-0 md:data-[state=closed]:slide-out-to-bottom-0 md:data-[state=closed]:slide-out-to-right md:data-[state=open]:slide-in-from-bottom-0 md:data-[state=open]:slide-in-from-right ${className}`}
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
        {...rest}
      >
        {/* Drag handle visual mobile-only (affordance bottom-sheet). En desktop
            el side drawer se cierra por X / ESC / backdrop, sin handle. */}
        <div
          aria-hidden="true"
          className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full md:hidden"
          style={{ backgroundColor: 'var(--border)' }}
        />
        {children}
      </RadixDialog.Content>
    </EditPanelPortal>
  )
}

/**
 * Header con title + botón de cerrar (X). `<EditPanelTitle>` es mandatory
 * adentro para satisfacer Radix Dialog `aria-labelledby`.
 */
export function EditPanelHeader({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex items-start justify-between gap-3 px-4 pb-3 pt-4 md:px-6 md:pt-6 ${className}`}
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <RadixDialog.Close
        aria-label="Cerrar"
        className="shrink-0 rounded-full p-2 transition-colors hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)]"
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
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </RadixDialog.Close>
    </div>
  )
}

export function EditPanelTitle(props: ComponentPropsWithoutRef<typeof RadixDialog.Title>) {
  const { className = '', ...rest } = props
  return (
    <RadixDialog.Title
      className={`font-serif text-lg leading-tight md:text-xl ${className}`}
      style={{ color: 'var(--text)' }}
      {...rest}
    />
  )
}

export function EditPanelDescription(
  props: ComponentPropsWithoutRef<typeof RadixDialog.Description>,
) {
  const { className = '', ...rest } = props
  return (
    <RadixDialog.Description
      className={`mt-1 text-sm ${className}`}
      style={{ color: 'var(--muted)' }}
      {...rest}
    />
  )
}

/**
 * Body scrollable. Padding horizontal aumenta en desktop (md:px-6) para
 * respiración consistente con el side drawer más ancho.
 */
export function EditPanelBody({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`flex-1 overflow-y-auto px-4 py-2 md:px-6 md:py-4 ${className}`}>
      {children}
    </div>
  )
}

/**
 * Footer sticky con CTAs primary/secondary. `safe-area-inset-bottom` heredado
 * del Content cubre el home indicator iOS en mobile.
 */
export function EditPanelFooter({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex shrink-0 flex-col gap-2 border-t px-4 pb-4 pt-3 md:px-6 md:pb-6 ${className}`}
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      {children}
    </div>
  )
}
