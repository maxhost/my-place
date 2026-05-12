'use client'

import { useState } from 'react'
import { LeavePlaceDialog } from '@/features/members/profile/public'

/**
 * Client wrapper que monta `<LeavePlaceDialog>` con state propio del open/close.
 *
 * Vive en `/settings/system` (ADR
 * `docs/decisions/2026-05-12-settings-system-for-lifecycle.md`). El callsite
 * previo en `<OwnersAccessPanel>` se movió acá — la lógica del dialog NO
 * cambia, solo el parent que lo monta.
 *
 * El page padre (`settings/system/page.tsx`) es Server Component. Este wrapper
 * Client es necesario para mantener el `useState` del overlay sin contaminar
 * la page con `'use client'`.
 *
 * El `<LeavePlaceDialog>` valida internamente "único owner sin transfer
 * previo" (`leave-place-dialog.tsx:67`) — ese hard gate cubre el caso edge
 * de owner que intenta salir sin pasar ownership a otro miembro.
 */
type Props = {
  placeSlug: string
  appUrl: string
}

export function LeaveSystemPanel({ placeSlug, appUrl }: Props): React.ReactNode {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-md px-4 text-sm font-medium text-red-600 hover:bg-red-50"
      >
        Salir de este place
      </button>
      <LeavePlaceDialog open={open} onOpenChange={setOpen} placeSlug={placeSlug} appUrl={appUrl} />
    </>
  )
}
