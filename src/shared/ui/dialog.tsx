'use client'

import * as RadixDialog from '@radix-ui/react-dialog'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

/**
 * Wrapper fino sobre Radix Dialog con estética del place. Las features
 * consumen `@/shared/ui/dialog` y no `@radix-ui/react-dialog` directo para que
 * (a) el look & feel quede centralizado acá, (b) cambiar la primitiva
 * subyacente no obligue a tocar callsites.
 *
 * Focus trap, ESC, aria-modal, labelledby/describedby, return focus al
 * trigger: los da Radix nativo. No los reimplementamos.
 *
 * z-index: overlay + content = 50. El `<Toaster />` se monta en 60 para que
 * el toast aparezca siempre por encima si un diálogo está abierto.
 */

export const Dialog = RadixDialog.Root
export const DialogTrigger = RadixDialog.Trigger
export const DialogPortal = RadixDialog.Portal
export const DialogClose = RadixDialog.Close

export function DialogOverlay(props: ComponentPropsWithoutRef<typeof RadixDialog.Overlay>) {
  const { className = '', ...rest } = props
  return (
    <RadixDialog.Overlay
      className={`fixed inset-0 z-50 bg-black/40 transition-opacity duration-150 data-[state=closed]:opacity-0 data-[state=open]:opacity-100 ${className}`}
      {...rest}
    />
  )
}

type DialogContentProps = ComponentPropsWithoutRef<typeof RadixDialog.Content> & {
  children: ReactNode
}

export function DialogContent({ children, className = '', ...rest }: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <RadixDialog.Content
        className={`fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border p-6 shadow-lg outline-none transition-opacity duration-150 data-[state=closed]:opacity-0 data-[state=open]:opacity-100 ${className}`}
        style={{
          backgroundColor: 'var(--place-card-bg)',
          borderColor: 'var(--place-divider)',
          color: 'var(--place-text)',
        }}
        {...rest}
      >
        {children}
      </RadixDialog.Content>
    </DialogPortal>
  )
}

export function DialogTitle(props: ComponentPropsWithoutRef<typeof RadixDialog.Title>) {
  const { className = '', ...rest } = props
  return (
    <RadixDialog.Title
      className={`font-serif text-lg ${className}`}
      style={{ color: 'var(--place-text)' }}
      {...rest}
    />
  )
}

export function DialogDescription(props: ComponentPropsWithoutRef<typeof RadixDialog.Description>) {
  const { className = '', ...rest } = props
  return (
    <RadixDialog.Description
      className={`mt-1 text-sm ${className}`}
      style={{ color: 'var(--place-text-soft)' }}
      {...rest}
    />
  )
}
