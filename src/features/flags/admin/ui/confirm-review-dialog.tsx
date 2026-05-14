'use client'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog'

export type ConfirmKind = 'hide' | 'delete' | null

type Props = {
  kind: ConfirmKind
  isComment: boolean
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Confirm dialog para acciones destructivas/sensibles del `<FlagDetailPanel>`.
 * Se monta como sibling del EditPanel (no anidado dentro) para que cada
 * Radix Dialog tenga su propio portal stack.
 *
 * `kind === null` → dialog cerrado (returns null).
 * `kind === 'hide'` → confirm para ocultar post (amber accent).
 * `kind === 'delete'` → confirm para eliminar post/comment (red accent,
 * destructive). Copy distinta según `isComment`.
 */
export function ConfirmReviewDialog({
  kind,
  isComment,
  pending,
  onCancel,
  onConfirm,
}: Props): React.ReactNode {
  return (
    <Dialog
      open={kind !== null}
      onOpenChange={(next) => {
        if (pending) return
        if (!next) onCancel()
      }}
    >
      <DialogContent>
        {kind === 'hide' ? (
          <>
            <DialogTitle>¿Ocultar este post?</DialogTitle>
            <DialogDescription>
              Los miembros dejarán de verlo. Podés des-ocultarlo después desde el listado de
              reportes resueltos.
            </DialogDescription>
          </>
        ) : null}
        {kind === 'delete' ? (
          <>
            <DialogTitle>{isComment ? '¿Eliminar comentario?' : '¿Eliminar post?'}</DialogTitle>
            <DialogDescription>
              {isComment
                ? 'El texto se reemplaza por «mensaje eliminado»; la posición queda en el thread.'
                : 'El post desaparece del foro junto con sus comentarios y reacciones. Esta acción no es reversible.'}
            </DialogDescription>
          </>
        ) : null}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-300 px-4 text-sm disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium text-white disabled:opacity-60 ${
              kind === 'delete'
                ? 'border-red-600 bg-red-600 hover:bg-red-700'
                : 'border-amber-600 bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {pending ? 'Aplicando…' : kind === 'delete' ? 'Sí, eliminar' : 'Sí, ocultar'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
