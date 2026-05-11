'use client'

import { useState } from 'react'
import type { DayOfWeek, RecurringWindow } from '@/features/hours/domain/types'
import { DAY_ORDER } from '@/features/hours/domain/types'
import { DayCard } from './week-editor-day-card'
import { WindowSheet, type SheetState } from './week-editor-window-sheet'

/**
 * Editor de ventanas recurrentes con layout card-por-día (mobile-native).
 *
 * Renderiza un `<div>` (no `<section>` con header propio) — el wrapper
 * semántico + heading lo aporta `<HoursForm>` (sección "Horario de
 * apertura" que incluye también la toggle "Abierto 24/7"). Acá solo
 * proveemos el contenido del editor.
 *
 * Renderiza UNA card por cada uno de los 7 días siempre (no condicional).
 * Cada card tiene un switch on/off:
 *  - OFF: card colapsado al header — visualmente comunica "este día está cerrado".
 *  - ON: card expandido con ventanas verticales + acciones inline visibles
 *    (Agregar ventana, Copiar a otros días).
 *
 * El alta y la edición ocurren en un `<BottomSheet>` (resuelve overflow en
 * mobile + se alinea con thumb-zone). Las ventanas NO cruzan medianoche
 * (documentado en `docs/features/hours/spec.md`); el Zod schema rechaza
 * `start >= end`.
 *
 * Toggle ON → OFF dispara `onReplace(arrayWithoutThisDay)` — bulk op, NO
 * autosavea (queda dirty para Save explícito). Toggle OFF → ON abre el
 * sheet add con el día preseleccionado.
 *
 * **API pública**: `fields`, `onAdd`, `onUpdate`, `onRemove`, `onReplace`.
 * El parent (`<HoursForm>`) es el ÚNICO que invoca `useFieldArray({ name:
 * 'recurring' })` — esa es la fuente canónica del array.
 *
 * Este archivo es el orquestador del sistema WeekEditor: maneja state
 * (`SheetState`), agrupa fields por día (`groupByDay`), implementa
 * copy-to-* y compone `<DayCard>` + `<WindowSheet>` (archivos siblings
 * `week-editor-day-card.tsx` y `week-editor-window-sheet.tsx`).
 */

export const DAY_ES: Record<DayOfWeek, string> = {
  MON: 'Lunes',
  TUE: 'Martes',
  WED: 'Miércoles',
  THU: 'Jueves',
  FRI: 'Viernes',
  SAT: 'Sábado',
  SUN: 'Domingo',
}

const WEEKDAYS: ReadonlyArray<DayOfWeek> = ['MON', 'TUE', 'WED', 'THU', 'FRI']
const WEEKEND: ReadonlyArray<DayOfWeek> = ['SAT', 'SUN']

export type IndexedWindow = RecurringWindow & { id: string; index: number }

type Props = {
  fields: Array<RecurringWindow & { id: string }>
  onAdd: (w: RecurringWindow) => void
  onUpdate: (idx: number, w: RecurringWindow) => void
  onRemove: (idx: number) => void
  /**
   * Reemplaza el array completo en una sola operación. Se usa para copy-to-*
   * (que cambia varias filas a la vez) — sin esto, esos handlers tendrían
   * que disparar N adds + M removes secuenciales, generando N+M requests
   * autosave + race condition si la DB serializa los writes mal.
   */
  onReplace: (next: RecurringWindow[]) => void
}

export function WeekEditor({ fields, onAdd, onUpdate, onRemove, onReplace }: Props) {
  const [sheet, setSheet] = useState<SheetState>({ mode: 'closed' })

  const byDay = groupByDay(fields)

  function openAdd(day: DayOfWeek) {
    setSheet({ mode: 'add', day })
  }

  function openEdit(window: IndexedWindow) {
    setSheet({
      mode: 'edit',
      day: window.day,
      index: window.index,
      start: window.start,
      end: window.end,
    })
  }

  function closeSheet() {
    setSheet({ mode: 'closed' })
  }

  /**
   * Toggle switch ON → OFF de un día: elimina TODAS las ventanas de ese día
   * en una sola operación (`onReplace`). NO autosavea — queda dirty para
   * que el user confirme con "Guardar cambios". Patrón consistente con
   * copy-to-* (también bulk vía `onReplace`).
   *
   * Sin confirmación inline: la operación es reversible (toggle ON → sheet
   * add). Si el user cierra antes de Save, las ventanas no se persisten en DB.
   */
  function toggleDayOff(day: DayOfWeek) {
    const next: RecurringWindow[] = fields
      .filter((w) => w.day !== day)
      .map(({ day: d, start, end }) => ({ day: d, start, end }))
    onReplace(next)
  }

  function copyTo(sourceDay: DayOfWeek, targetDays: ReadonlyArray<DayOfWeek>) {
    const source = byDay.get(sourceDay) ?? []
    if (source.length === 0) return

    // Computamos el array nuevo en una sola pasada y lo enviamos via
    // `onReplace`. Esto reemplaza la versión anterior que disparaba N `onAdd`
    // + M `onRemove` secuenciales — ese patrón generaba N+M requests
    // autosave + introducía race conditions si la DB serializaba los writes
    // de forma diferente al orden esperado.
    const targetSet = new Set(targetDays.filter((d) => d !== sourceDay))

    const kept: RecurringWindow[] = fields
      .filter((w) => !targetSet.has(w.day))
      .map(({ day, start, end }) => ({ day, start, end }))

    const additions: RecurringWindow[] = []
    for (const target of targetSet) {
      for (const w of source) {
        additions.push({ day: target, start: w.start, end: w.end })
      }
    }

    onReplace([...kept, ...additions])
  }

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Horarios que se repiten cada semana. Una ventana debe ser del mismo día (no cruza
        medianoche): para abrir hasta la 01:00 del día siguiente, agregá dos ventanas (ej. sábado
        22:00–23:59 y domingo 00:00–01:00).
      </p>

      <div className="space-y-3">
        {DAY_ORDER.map((day) => (
          <DayCard
            key={day}
            day={day}
            windows={byDay.get(day) ?? []}
            onAddWindow={() => openAdd(day)}
            onEditWindow={openEdit}
            onRemoveWindow={onRemove}
            onToggleOff={() => toggleDayOff(day)}
            onCopyToAll={() =>
              copyTo(
                day,
                DAY_ORDER.filter((d) => d !== day),
              )
            }
            onCopyToWeekdays={() => copyTo(day, WEEKDAYS)}
            onCopyToWeekend={() => copyTo(day, WEEKEND)}
          />
        ))}
      </div>

      <WindowSheet
        sheet={sheet}
        onClose={closeSheet}
        onAdd={(w) => {
          onAdd(w)
          closeSheet()
        }}
        onUpdate={(idx, w) => {
          onUpdate(idx, w)
          closeSheet()
        }}
        onRemove={(idx) => {
          onRemove(idx)
          closeSheet()
        }}
      />
    </div>
  )
}

function groupByDay(
  fields: Array<RecurringWindow & { id: string }>,
): Map<DayOfWeek, IndexedWindow[]> {
  const map = new Map<DayOfWeek, IndexedWindow[]>()
  fields.forEach((field, index) => {
    const list = map.get(field.day) ?? []
    list.push({ ...field, index })
    map.set(field.day, list)
  })
  // Orden interno por hora de inicio para que los chips se lean cronológicamente.
  for (const [day, list] of map) {
    list.sort((a, b) => a.start.localeCompare(b.start))
    map.set(day, list)
  }
  return map
}
