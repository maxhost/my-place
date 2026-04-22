'use client'

import React, { useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog'
import { toast } from '@/shared/ui/toaster'
import { FLAG_NOTE_MAX_LENGTH } from '../domain/invariants'
import { FlagAlreadyExists } from '../domain/errors'
import { flagAction } from '../server/actions'

type ReasonValue = 'SPAM' | 'HARASSMENT' | 'OFFTOPIC' | 'MISINFO' | 'OTHER'

const REASON_OPTIONS: ReadonlyArray<{ value: ReasonValue; label: string }> = [
  { value: 'SPAM', label: 'Spam o contenido comercial' },
  { value: 'HARASSMENT', label: 'Acoso o agresión' },
  { value: 'OFFTOPIC', label: 'Fuera de tema' },
  { value: 'MISINFO', label: 'Desinformación' },
  { value: 'OTHER', label: 'Otro motivo' },
]

type Props = {
  targetType: 'POST' | 'COMMENT'
  targetId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FlagModal({ targetType, targetId, open, onOpenChange }: Props): React.ReactElement {
  const [reason, setReason] = useState<'' | ReasonValue>('')
  const [note, setNote] = useState('')
  const [pending, startTransition] = useTransition()

  function reset(): void {
    setReason('')
    setNote('')
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!reason) return

    const input = {
      targetType,
      targetId,
      reason,
      ...(note.trim() ? { reasonNote: note.trim() } : {}),
    }

    startTransition(async () => {
      try {
        await flagAction(input)
        toast.success('Gracias, lo revisamos.')
        reset()
        onOpenChange(false)
      } catch (err) {
        if (err instanceof FlagAlreadyExists) {
          toast('Ya reportaste este contenido.')
          return
        }
        toast.error('No pudimos enviar el reporte. Reintentá en un momento.')
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogTitle>Reportar este contenido</DialogTitle>
        <DialogDescription>
          Un admin del place revisará el reporte. Tu identidad queda reservada.
        </DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="flag-reason" className="text-sm text-[color:var(--place-text)]">
              Motivo
            </label>
            <select
              id="flag-reason"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value as '' | ReasonValue)}
              disabled={pending}
              className="rounded border border-[color:var(--place-divider)] bg-[color:var(--place-card-bg)] px-3 py-2 text-sm text-[color:var(--place-text)] focus:border-[color:var(--place-mark-fg)] focus:outline-none"
            >
              <option value="" disabled>
                Elegí un motivo
              </option>
              {REASON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="flag-note" className="text-sm text-[color:var(--place-text)]">
              Nota (opcional)
            </label>
            <textarea
              id="flag-note"
              rows={3}
              maxLength={FLAG_NOTE_MAX_LENGTH}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={pending}
              placeholder="Agregá contexto si hace falta"
              className="resize-none rounded border border-[color:var(--place-divider)] bg-[color:var(--place-card-bg)] px-3 py-2 text-sm text-[color:var(--place-text)] focus:border-[color:var(--place-mark-fg)] focus:outline-none"
            />
            <span className="text-xs text-[color:var(--place-text-soft)]">
              {note.length}/{FLAG_NOTE_MAX_LENGTH}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="rounded px-3 py-1.5 text-sm text-[color:var(--place-text-soft)] hover:text-[color:var(--place-text)]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending || !reason}
              className="rounded bg-[color:var(--place-mark-bg)] px-3 py-1.5 text-sm font-medium text-[color:var(--place-mark-fg)] disabled:opacity-60"
            >
              {pending ? 'Enviando…' : 'Reportar'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
