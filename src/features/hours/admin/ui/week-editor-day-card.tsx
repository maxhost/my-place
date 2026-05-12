'use client'

import { Pencil, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { RowActions } from '@/shared/ui/row-actions'
import type { DayOfWeek } from '@/features/hours/domain/types'
import { formatTime } from '@/features/hours/ui/format-time'
import { DAY_ES, type IndexedWindow } from './week-editor'

/**
 * Card por día con switch on/off + ventanas inline + acciones contextuales.
 *
 * **Diseño "acciones fuera del scroll path" (iter 2026-05-11):**
 *
 * El body de la card contiene SOLO chips de información (ventanas + chip
 * "+ Agregar"). Cero botones full-width. Razón: en mobile, scroll touch
 * tiene threshold ~10px de movement; un dedo apoyado sobre un botón
 * grande puede activarlo accidentalmente al hacer swipe vertical. El
 * patrón anterior (botones `min-h-11 w-full` para "+ Agregar ventana" y
 * "Copiar a otros días") era propenso a este accident.
 *
 * Ahora:
 *  - "+ Agregar ventana" es un chip pequeño (mismo size que las ventanas
 *    existentes) inline al final de la fila — discoverable sin ser zona
 *    grande de tap accidental.
 *  - "Copiar a otros días…" + "Agregar ventana" viven en un menú 3-dots
 *    en el header de la card (al lado del switch). 44×44px típico de
 *    overflow menu, lejos del scroll path del body.
 *
 * El parent (`<WeekEditor>`) renderiza UNA card por cada uno de los 7 días
 * (no condicional por `presentDays`). El switch refleja `windows.length > 0`.
 *
 * Switch ON → OFF: dispara `onToggleOff()` que el parent traduce a
 * `onReplace(arrayWithoutThisDay)` — bulk op, NO autosavea (queda dirty para
 * Save explícito). Switch OFF → ON: dispara `onAddWindow()` que abre el sheet
 * con el día preseleccionado.
 *
 * **Pattern doc:** ver `docs/ux-patterns.md` § "Per-item dropdown menus" y
 * § "Touch target minimums".
 */

type Props = {
  day: DayOfWeek
  windows: IndexedWindow[]
  onAddWindow: () => void
  onEditWindow: (w: IndexedWindow) => void
  onRemoveWindow: (idx: number) => void
  onToggleOff: () => void
  onCopyToAll: () => void
  onCopyToWeekdays: () => void
  onCopyToWeekend: () => void
}

export function DayCard({
  day,
  windows,
  onAddWindow,
  onEditWindow,
  onRemoveWindow,
  onToggleOff,
  onCopyToAll,
  onCopyToWeekdays,
  onCopyToWeekend,
}: Props) {
  const isOn = windows.length > 0
  const dayName = DAY_ES[day]

  return (
    <div className="rounded-md border border-neutral-200">
      {/* Header del día: nombre + estado + (3-dots si ON) + switch.
          El 3-dots solo aparece cuando ON — para OFF no hay acciones
          contextuales (toggle ON via switch abre el sheet add). */}
      <div
        className={`flex min-h-[56px] items-center gap-2 px-3 ${isOn ? 'border-b border-neutral-200' : ''}`}
      >
        <span className="flex-1 text-base font-medium text-neutral-900">{dayName}</span>
        <span className="text-xs text-neutral-500">{isOn ? 'Abierto' : 'Cerrado'}</span>
        {isOn ? (
          <DayOverflowMenu
            dayName={dayName}
            onAddWindow={onAddWindow}
            onCopyToAll={onCopyToAll}
            onCopyToWeekdays={onCopyToWeekdays}
            onCopyToWeekend={onCopyToWeekend}
          />
        ) : null}
        <DaySwitch
          isOn={isOn}
          dayName={dayName}
          onToggle={(next) => {
            if (next) onAddWindow()
            else onToggleOff()
          }}
        />
      </div>

      {/* Body solo se renderea cuando hay ventanas. Layout horizontal con
          flex-wrap: chips de ventanas únicamente. "Agregar ventana" vive
          en el menú 3-dots del header — no duplicamos affordance.
          Body 100% safe to scroll (zero botones full-width). */}
      {isOn ? (
        <div className="flex flex-wrap items-center gap-2 px-3 py-3">
          {windows.map((w) => (
            <RowActions
              key={w.id}
              triggerLabel={`Opciones para ventana ${w.start} a ${w.end} del ${dayName}`}
              chipClassName="inline-flex min-h-11 items-center rounded-full border border-neutral-300 px-3 py-2 text-sm tabular-nums hover:border-neutral-500"
              actions={[
                {
                  icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
                  label: 'Editar',
                  onSelect: () => onEditWindow(w),
                },
                {
                  icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
                  label: 'Eliminar',
                  onSelect: () => onRemoveWindow(w.index),
                  destructive: true,
                },
              ]}
            >
              <span suppressHydrationWarning>
                {formatTime(w.start)} → {formatTime(w.end)}
              </span>
            </RowActions>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Menú overflow del día (3-dots) en el header. Solo aparece cuando el día
 * está ON. Items: agregar ventana adicional, copiar a otros días en sus
 * 3 variantes. Patrón canónico: ver `ux-patterns.md` § "Per-item dropdown menus".
 */
function DayOverflowMenu({
  dayName,
  onAddWindow,
  onCopyToAll,
  onCopyToWeekdays,
  onCopyToWeekend,
}: {
  dayName: string
  onAddWindow: () => void
  onCopyToAll: () => void
  onCopyToWeekdays: () => void
  onCopyToWeekend: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100"
          aria-label={`Más opciones para ${dayName}`}
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
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="19" r="1" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onAddWindow}>Agregar ventana</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCopyToAll}>Copiar a todos los días</DropdownMenuItem>
        <DropdownMenuItem onSelect={onCopyToWeekdays}>Copiar a días de semana</DropdownMenuItem>
        <DropdownMenuItem onSelect={onCopyToWeekend}>Copiar a fin de semana</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Switch accesible sin dep nueva. `role="switch"` + `aria-checked` cumplen
 * con WAI-ARIA Authoring Practices. Touch target 44px (alto del label
 * tappable es ≥44px porque el contenedor padre del switch tiene min-h-[56px]).
 *
 * Ancho 44px del switch en sí (h-6 w-11 = 24×44px). El thumb (h-5 w-5)
 * desliza con `translate-x` y la transición CSS suaviza el cambio.
 */
function DaySwitch({
  isOn,
  dayName,
  onToggle,
}: {
  isOn: boolean
  dayName: string
  onToggle: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={`${dayName}: ${isOn ? 'abierto, tocá para cerrar' : 'cerrado, tocá para abrir'}`}
      onClick={() => onToggle(!isOn)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 ${
        isOn ? 'bg-neutral-900' : 'bg-neutral-300'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          isOn ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
