'use client'

import { useState } from 'react'
import { useFormContext } from 'react-hook-form'
import type { DateException } from '../domain/types'

/**
 * Editor de excepciones por fecha. Dos tipos:
 * - `closed: true` → cerrado aunque el día caiga en una ventana recurrente
 *   (feriado, día de duelo, feria cerrada).
 * - `windows: [...]` → apertura extraordinaria en un día que normalmente estaría
 *   cerrado (ej. un sábado puntual).
 *
 * La `date` se interpreta en el timezone del place (no UTC).
 */

type DraftKind = 'closed' | 'open'

type Props = {
  fields: Array<DateException & { id: string }>
  onAdd: (e: DateException) => void
  onRemove: (idx: number) => void
}

export function ExceptionsEditor({ fields, onAdd, onRemove }: Props) {
  const { register } = useFormContext()
  const [kind, setKind] = useState<DraftKind>('closed')
  const [date, setDate] = useState('')
  const [start, setStart] = useState('10:00')
  const [end, setEnd] = useState('17:00')

  function add() {
    if (!date) return
    if (kind === 'closed') {
      onAdd({ date, closed: true })
    } else {
      onAdd({ date, windows: [{ start, end }] })
    }
    setDate('')
  }

  return (
    <section className="space-y-3">
      <header>
        <h2 className="font-serif text-xl italic">Excepciones</h2>
        <p className="text-xs text-neutral-500">
          Feriados o aperturas extraordinarias. La fecha se interpreta en el timezone del place. Una
          excepción sobreescribe completamente las ventanas recurrentes de ese día.
        </p>
      </header>

      {fields.length === 0 ? (
        <p className="text-sm italic text-neutral-500">Sin excepciones.</p>
      ) : (
        <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
          {fields.map((field, idx) => (
            <li key={field.id} className="flex items-center gap-3 py-2 text-sm">
              <input
                type="hidden"
                {...register(`exceptions.${idx}.date` as const)}
                defaultValue={field.date}
              />
              <span className="w-28 font-mono text-neutral-600">{field.date}</span>
              <span className="flex-1">
                {'closed' in field
                  ? 'cerrado'
                  : field.windows.map((w) => `${w.start}–${w.end}`).join(', ')}
              </span>
              <button
                type="button"
                onClick={() => onRemove(idx)}
                className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-amber-500 hover:text-amber-700"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 rounded-md border border-dashed border-neutral-300 p-3">
        <div className="flex gap-4 text-sm text-neutral-700">
          <label className="flex items-center gap-1">
            <input type="radio" checked={kind === 'closed'} onChange={() => setKind('closed')} />
            Cerrar este día
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={kind === 'open'} onChange={() => setKind('open')} />
            Abrir extraordinariamente
          </label>
        </div>

        <div className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm"
          />
          {kind === 'open' ? (
            <>
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm"
              />
              <input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm"
              />
            </>
          ) : (
            <>
              <span />
              <span />
            </>
          )}
          <button
            type="button"
            onClick={add}
            disabled={!date}
            className="rounded-md bg-neutral-900 px-3 py-1 text-xs text-white disabled:opacity-50"
          >
            Agregar
          </button>
        </div>
      </div>
    </section>
  )
}
