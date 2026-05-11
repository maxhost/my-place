'use client'

import { useState } from 'react'
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetClose,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetFooter,
  BottomSheetHeader,
  BottomSheetTitle,
} from '@/shared/ui/bottom-sheet'
import type { DateException } from '@/features/hours/domain/types'
import { formatTime } from '@/features/hours/ui/format-time'

/**
 * Editor de excepciones por fecha. Dos tipos:
 * - `closed: true` → cerrado aunque el día caiga en una ventana recurrente
 *   (feriado, día de duelo, feria cerrada).
 * - `windows: [...]` → apertura extraordinaria en un día que normalmente estaría
 *   cerrado (ej. un sábado puntual).
 *
 * La `date` se interpreta en el timezone del place (no UTC).
 *
 * UX: lista de filas tappables + botón "Agregar excepción" full-width que
 * abre un `<BottomSheet>`. La edición ocurre en el mismo sheet (tap fila).
 *
 * **API pública**: `fields`, `onAdd`, `onUpdate`, `onRemove`. El parent
 * (`<HoursForm>`) es el ÚNICO que invoca `useFieldArray({ name: 'exceptions' })`
 * — esa es la fuente canónica del array. Tener dos instancias del mismo
 * `name` causa desyncs (RHF docs: "only one is effective"), que se
 * manifiestan como filas que no actualizan tras editar.
 */

type Props = {
  fields: Array<DateException & { id: string }>
  onAdd: (e: DateException) => void
  onUpdate: (idx: number, e: DateException) => void
  onRemove: (idx: number) => void
}

type SheetState =
  | { mode: 'closed' }
  | { mode: 'add' }
  | { mode: 'edit'; index: number; initial: DateException }

export function ExceptionsEditor({ fields, onAdd, onUpdate, onRemove }: Props) {
  const [sheet, setSheet] = useState<SheetState>({ mode: 'closed' })

  function openAdd() {
    setSheet({ mode: 'add' })
  }

  function openEdit(idx: number, initial: DateException) {
    setSheet({ mode: 'edit', index: idx, initial })
  }

  function closeSheet() {
    setSheet({ mode: 'closed' })
  }

  return (
    <section className="space-y-3" aria-labelledby="hours-exceptions-heading">
      <h2
        id="hours-exceptions-heading"
        className="border-b pb-2 font-serif text-xl"
        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        Excepciones
      </h2>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Feriados o aperturas extraordinarias. La fecha se interpreta en el timezone del place. Una
        excepción sobreescribe completamente las ventanas recurrentes de ese día.
      </p>

      {fields.length === 0 ? (
        <p className="text-sm italic text-neutral-500">Sin excepciones.</p>
      ) : (
        <ExceptionsGroupedList fields={fields} onEdit={openEdit} />
      )}

      <button
        type="button"
        onClick={openAdd}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-dashed border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:border-neutral-500"
      >
        + Agregar excepción
      </button>

      <ExceptionSheet
        sheet={sheet}
        onClose={closeSheet}
        onAdd={(e) => {
          onAdd(e)
          closeSheet()
        }}
        onUpdate={(idx, e) => {
          onUpdate(idx, e)
          closeSheet()
        }}
        onRemove={(idx) => {
          onRemove(idx)
          closeSheet()
        }}
      />
    </section>
  )
}

function stripId(field: DateException & { id: string }): DateException {
  if ('closed' in field) {
    return { date: field.date, closed: true }
  }
  return { date: field.date, windows: field.windows.map((w) => ({ start: w.start, end: w.end })) }
}

/**
 * Lista agrupada por mes-año. Mejora vs la lista plana anterior:
 *  - Header subtle por mes ayuda al scanning cuando hay >5 excepciones.
 *  - Cada card muestra día numérico grande + abreviatura día semanal,
 *    en vez del `YYYY-MM-DD` técnico anterior.
 *  - Dot de color (rojo cerrado, ámbar especial) diferencia tipo
 *    visualmente sin depender solo del texto del badge.
 */
function ExceptionsGroupedList({
  fields,
  onEdit,
}: {
  fields: Array<DateException & { id: string }>
  onEdit: (idx: number, initial: DateException) => void
}) {
  // Group preserving original index para los callbacks.
  type Indexed = { field: DateException & { id: string }; index: number }
  const grouped = new Map<string, Indexed[]>()
  fields.forEach((field, index) => {
    const monthKey = field.date.slice(0, 7) // YYYY-MM
    const list = grouped.get(monthKey) ?? []
    list.push({ field, index })
    grouped.set(monthKey, list)
  })
  // Orden cronológico ascendente (mes y dentro del mes por fecha).
  const monthKeys = Array.from(grouped.keys()).sort()
  for (const key of monthKeys) {
    const list = grouped.get(key)
    if (list) list.sort((a, b) => a.field.date.localeCompare(b.field.date))
  }

  return (
    <div className="space-y-4">
      {monthKeys.map((monthKey) => {
        const items = grouped.get(monthKey) ?? []
        return (
          <div key={monthKey} className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-neutral-500">
              {formatMonthHeader(monthKey)}
            </h3>
            <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
              {items.map(({ field, index }) => (
                <li key={field.id}>
                  <ExceptionCard field={field} onEdit={() => onEdit(index, stripId(field))} />
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

function ExceptionCard({
  field,
  onEdit,
}: {
  field: DateException & { id: string }
  onEdit: () => void
}) {
  const isClosed = 'closed' in field
  const { dayNum, weekdayShort } = parseDateParts(field.date)

  return (
    <button
      type="button"
      onClick={onEdit}
      className="flex min-h-[64px] w-full items-center gap-3 px-1 py-3 text-left hover:bg-neutral-50"
      aria-label={`Editar excepción del ${formatDateLong(field.date)}`}
    >
      <div className="flex w-12 flex-col items-center text-neutral-700" aria-hidden="true">
        <span className="text-2xl font-medium tabular-nums leading-none">{dayNum}</span>
        <span className="mt-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
          {weekdayShort}
        </span>
      </div>
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${isClosed ? 'bg-red-500' : 'bg-amber-500'}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-neutral-800">
          {isClosed ? 'Cerrado' : 'Horario especial'}
        </p>
        {!isClosed ? (
          <p className="text-xs tabular-nums text-neutral-600" suppressHydrationWarning>
            {field.windows.map((w) => `${formatTime(w.start)} → ${formatTime(w.end)}`).join(' · ')}
          </p>
        ) : null}
      </div>
      <span aria-hidden="true" className="text-neutral-400">
        ›
      </span>
    </button>
  )
}

const MONTHS_LONG = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const
const WEEKDAY_SHORT_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const

function formatMonthHeader(monthKey: string): string {
  // monthKey es 'YYYY-MM'. Devuelve "Diciembre 2026".
  const [y, m] = monthKey.split('-')
  if (!y || !m) return monthKey
  const monthName = MONTHS_LONG[Number(m) - 1] ?? m
  // Capitalizamos primera letra para uso como header.
  const display = monthName.charAt(0).toUpperCase() + monthName.slice(1)
  return `${display} ${y}`
}

function parseDateParts(date: string): { dayNum: string; weekdayShort: string } {
  const [y, m, d] = date.split('-')
  if (!y || !m || !d) return { dayNum: '?', weekdayShort: '???' }
  const dayNum = String(Number(d))
  // Calculamos día de la semana de manera determinística (Zeller's o
  // construyendo Date noon-UTC para evitar shifts de timezone). Usamos
  // Date con noon UTC: cualquier timezone shift queda dentro del mismo día.
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 12))
  const weekday = dt.getUTCDay() // 0=Dom..6=Sáb
  const weekdayShort = WEEKDAY_SHORT_ES[weekday] ?? '???'
  return { dayNum, weekdayShort }
}

function formatDateLong(date: string): string {
  // `date` viene como YYYY-MM-DD; lo formateamos sin construir un Date
  // (evita corrimientos por timezone del viewer).
  const [y, m, d] = date.split('-')
  if (!y || !m || !d) return date
  const months = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ]
  const monthIdx = Number(m) - 1
  const monthName = months[monthIdx] ?? m
  return `${Number(d)} de ${monthName} ${y}`
}

function ExceptionSheet({
  sheet,
  onClose,
  onAdd,
  onUpdate,
  onRemove,
}: {
  sheet: SheetState
  onClose: () => void
  onAdd: (e: DateException) => void
  onUpdate: (idx: number, e: DateException) => void
  onRemove: (idx: number) => void
}) {
  const open = sheet.mode !== 'closed'
  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      {open ? (
        <ExceptionSheetForm sheet={sheet} onAdd={onAdd} onUpdate={onUpdate} onRemove={onRemove} />
      ) : null}
    </BottomSheet>
  )
}

type Kind = 'closed' | 'open'

function ExceptionSheetForm({
  sheet,
  onAdd,
  onUpdate,
  onRemove,
}: {
  sheet: Exclude<SheetState, { mode: 'closed' }>
  onAdd: (e: DateException) => void
  onUpdate: (idx: number, e: DateException) => void
  onRemove: (idx: number) => void
}) {
  const initial = sheet.mode === 'edit' ? sheet.initial : null
  const [date, setDate] = useState(initial?.date ?? '')
  const [kind, setKind] = useState<Kind>(
    initial && 'closed' in initial ? 'closed' : initial ? 'open' : 'closed',
  )
  const [start, setStart] = useState(
    initial && 'windows' in initial ? (initial.windows[0]?.start ?? '10:00') : '10:00',
  )
  const [end, setEnd] = useState(
    initial && 'windows' in initial ? (initial.windows[0]?.end ?? '17:00') : '17:00',
  )
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  function build(): DateException | null {
    if (!date) {
      setError('Elegí una fecha.')
      return null
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Fecha inválida.')
      return null
    }
    if (kind === 'closed') {
      setError(null)
      return { date, closed: true }
    }
    if (!start || !end) {
      setError('Ingresá hora de inicio y fin.')
      return null
    }
    if (start >= end) {
      setError('La hora de fin debe ser posterior a la de inicio.')
      return null
    }
    setError(null)
    return { date, windows: [{ start, end }] }
  }

  function handleSubmit() {
    const built = build()
    if (!built) return
    if (sheet.mode === 'edit') {
      onUpdate(sheet.index, built)
    } else {
      onAdd(built)
    }
  }

  const title =
    sheet.mode === 'edit'
      ? `Editar excepción del ${formatDateShort(sheet.initial.date)}`
      : 'Agregar excepción'

  return (
    <BottomSheetContent aria-describedby={undefined}>
      <BottomSheetHeader>
        <BottomSheetTitle>{title}</BottomSheetTitle>
        <BottomSheetDescription>
          Una excepción sobreescribe el horario recurrente de esa fecha.
        </BottomSheetDescription>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div className="space-y-4 py-2">
          <label className="block">
            <span className="mb-1 block text-sm text-neutral-600">Fecha</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="block min-h-[44px] w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base focus:border-neutral-500 focus:outline-none"
            />
          </label>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm text-neutral-600">Tipo de excepción</legend>
            <label className="flex min-h-11 items-center gap-2 text-base">
              <input
                type="radio"
                name="exception-kind"
                checked={kind === 'closed'}
                onChange={() => setKind('closed')}
                className="h-4 w-4"
              />
              Cerrado
            </label>
            <label className="flex min-h-11 items-center gap-2 text-base">
              <input
                type="radio"
                name="exception-kind"
                checked={kind === 'open'}
                onChange={() => setKind('open')}
                className="h-4 w-4"
              />
              Horario especial
            </label>
          </fieldset>

          {kind === 'open' ? (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-sm text-neutral-600">Desde</span>
                <input
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="block min-h-[44px] w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base tabular-nums focus:border-neutral-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-neutral-600">Hasta</span>
                <input
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="block min-h-[44px] w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base tabular-nums focus:border-neutral-500 focus:outline-none"
                />
              </label>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-amber-700">
              {error}
            </p>
          ) : null}
        </div>
      </BottomSheetBody>
      <BottomSheetFooter>
        <button
          type="button"
          onClick={handleSubmit}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white"
        >
          Guardar
        </button>
        {sheet.mode === 'edit' ? (
          confirmDelete ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-neutral-300 px-4 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => onRemove(sheet.index)}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-red-600 bg-red-600 px-4 text-sm font-medium text-white"
              >
                Sí, eliminar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Eliminar
            </button>
          )
        ) : (
          <BottomSheetClose asChild>
            <button
              type="button"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-neutral-300 px-4 text-sm"
            >
              Cancelar
            </button>
          </BottomSheetClose>
        )}
      </BottomSheetFooter>
    </BottomSheetContent>
  )
}

function formatDateShort(date: string): string {
  const [y, m, d] = date.split('-')
  if (!y || !m || !d) return date
  return `${d}/${m}/${y}`
}
