'use client'

import * as RadixDropdown from '@radix-ui/react-dropdown-menu'
import type { ComponentPropsWithoutRef } from 'react'

/**
 * Wrapper fino sobre Radix Dropdown Menu con estética del place. Las features
 * lo consumen desde `@/shared/ui/dropdown-menu` — nunca `@radix-ui/react-dropdown-menu`
 * directo — para que el estilo y la primitiva vivan centralizados.
 *
 * Focus trap (el trigger retoma el focus al cerrar), navegación con teclado,
 * aria-haspopup, ESC para cerrar: todo Radix nativo. El portal se monta a
 * nivel de `<body>`, así que no lo perturba el overflow del contenedor.
 *
 * z-index 50: mismo nivel que Dialog. El `<Toaster />` (z=60) queda siempre
 * por encima.
 */

export const DropdownMenu = RadixDropdown.Root
export const DropdownMenuTrigger = RadixDropdown.Trigger

export function DropdownMenuContent(props: ComponentPropsWithoutRef<typeof RadixDropdown.Content>) {
  const { className = '', sideOffset = 4, align = 'end', ...rest } = props
  return (
    <RadixDropdown.Portal>
      <RadixDropdown.Content
        sideOffset={sideOffset}
        align={align}
        className={`data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 z-50 min-w-[10rem] overflow-hidden rounded-md border p-1 shadow-md outline-none ${className}`}
        style={{
          backgroundColor: 'var(--place-card-bg)',
          borderColor: 'var(--place-divider)',
          color: 'var(--place-text)',
        }}
        {...rest}
      />
    </RadixDropdown.Portal>
  )
}

export function DropdownMenuItem(
  props: ComponentPropsWithoutRef<typeof RadixDropdown.Item> & {
    destructive?: boolean
  },
) {
  const { className = '', destructive = false, style, ...rest } = props
  return (
    <RadixDropdown.Item
      className={`relative flex cursor-pointer select-none items-center rounded px-2 py-1.5 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[highlighted]:bg-[var(--place-hover,rgba(0,0,0,0.06))] data-[disabled]:opacity-50 ${className}`}
      style={{
        color: destructive ? 'var(--place-danger, #b00020)' : 'var(--place-text)',
        ...style,
      }}
      {...rest}
    />
  )
}

export function DropdownMenuSeparator(
  props: ComponentPropsWithoutRef<typeof RadixDropdown.Separator>,
) {
  const { className = '', ...rest } = props
  return (
    <RadixDropdown.Separator
      className={`my-1 h-px ${className}`}
      style={{ backgroundColor: 'var(--place-divider)' }}
      {...rest}
    />
  )
}

export function DropdownMenuLabel(props: ComponentPropsWithoutRef<typeof RadixDropdown.Label>) {
  const { className = '', ...rest } = props
  return (
    <RadixDropdown.Label
      className={`px-2 py-1.5 text-xs font-medium ${className}`}
      style={{ color: 'var(--place-text-soft)' }}
      {...rest}
    />
  )
}
