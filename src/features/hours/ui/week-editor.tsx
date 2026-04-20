'use client'

import { useState } from 'react'
import { useFormContext } from 'react-hook-form'
import type { DayOfWeek, RecurringWindow } from '../domain/types'
import { DAY_ORDER } from '../domain/types'

/**
 * Editor plano de ventanas recurrentes. Cada ventana es una fila con day + start
 * + end. No agrupamos visualmente por día porque simplifica el modelo mental
 * ("una lista de cuándo abre") y encaja con el `useFieldArray` del form padre.
 *
 * Las ventanas NO pueden cruzar medianoche (documentado en spec). La UI tiene un
 * hint visible; el Zod schema también rechaza `start >= end`.
 */

const DAY_ES: Record<DayOfWeek, string> = {
  MON: 'Lunes',
  TUE: 'Martes',
  WED: 'Miércoles',
  THU: 'Jueves',
  FRI: 'Viernes',
  SAT: 'Sábado',
  SUN: 'Domingo',
}

type Props = {
  fields: Array<RecurringWindow & { id: string }>
  onAdd: (w: RecurringWindow) => void
  onRemove: (idx: number) => void
}

export function WeekEditor({ fields, onAdd, onRemove }: Props) {
  const { register } = useFormContext()
  const [draftDay, setDraftDay] = useState<DayOfWeek>('MON')
  const [draftStart, setDraftStart] = useState('19:00')
  const [draftEnd, setDraftEnd] = useState('23:00')

  return (
    <section className="space-y-3">
      <header>
        <h2 className="font-serif text-xl italic">Ventanas recurrentes</h2>
        <p className="text-xs text-neutral-500">
          Horarios que se repiten cada semana. Una ventana debe ser del mismo día (no cruza
          medianoche): para abrir hasta la 01:00 del día siguiente, agregá dos ventanas (ej. sábado
          22:00–23:59 y domingo 00:00–01:00).
        </p>
      </header>

      {fields.length === 0 ? (
        <p className="text-sm italic text-neutral-500">
          Sin ventanas. El place queda cerrado hasta que agregues al menos una.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
          {fields.map((field, idx) => (
            <li
              key={field.id}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 py-2"
            >
              <select
                {...register(`recurring.${idx}.day` as const)}
                defaultValue={field.day}
                className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm"
              >
                {DAY_ORDER.map((d) => (
                  <option key={d} value={d}>
                    {DAY_ES[d]}
                  </option>
                ))}
              </select>
              <input
                type="time"
                {...register(`recurring.${idx}.start` as const)}
                defaultValue={field.start}
                className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm"
              />
              <input
                type="time"
                {...register(`recurring.${idx}.end` as const)}
                defaultValue={field.end}
                className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm"
              />
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

      <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded-md border border-dashed border-neutral-300 p-2">
        <select
          value={draftDay}
          onChange={(e) => setDraftDay(e.target.value as DayOfWeek)}
          className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm"
        >
          {DAY_ORDER.map((d) => (
            <option key={d} value={d}>
              {DAY_ES[d]}
            </option>
          ))}
        </select>
        <input
          type="time"
          value={draftStart}
          onChange={(e) => setDraftStart(e.target.value)}
          className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm"
        />
        <input
          type="time"
          value={draftEnd}
          onChange={(e) => setDraftEnd(e.target.value)}
          className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={() => onAdd({ day: draftDay, start: draftStart, end: draftEnd })}
          className="rounded-md bg-neutral-900 px-3 py-1 text-xs text-white"
        >
          Agregar
        </button>
      </div>
    </section>
  )
}
