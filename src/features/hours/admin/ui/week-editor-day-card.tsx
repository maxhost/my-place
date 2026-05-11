'use client'

import { Pencil, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { RowActions } from '@/shared/ui/row-actions'
import type { DayOfWeek } from '@/features/hours/domain/types'
import { formatTime } from '@/features/hours/ui/format-time'
import { DAY_ES, type IndexedWindow } from './week-editor'

/**
 * Card por día con switch on/off + ventanas inline + acciones visibles.
 *
 * Reemplaza al `<DayRow>` chip-row que vivía en `week-editor-day-row.tsx`.
 * Diferencias clave:
 *  - Card con border + header propio (en vez de row de tabla `divide-y`).
 *  - Switch on/off prominente como único control de "este día está abierto".
 *  - Cuando ON: ventanas como chips verticales, "+ Agregar ventana" inline,
 *    y "Copiar a otros días" como botón visible (no escondido en overflow).
 *  - Cuando OFF: card colapsado a solo el header — cero contenido extra.
 *
 * El parent (`<WeekEditor>`) renderiza UNA card por cada uno de los 7 días
 * (no condicional por `presentDays`). El switch refleja `windows.length > 0`.
 *
 * Switch ON → OFF: dispara `onToggleOff()` que el parent traduce a
 * `onReplace(arrayWithoutThisDay)` — bulk op, NO autosavea (queda dirty para
 * Save explícito). Switch OFF → ON: dispara `onAddWindow()` que abre el sheet
 * con el día preseleccionado.
 *
 * **Pattern doc:** ver `docs/ux-patterns.md` § "Color palette & button styles"
 * y § "Per-item dropdown menus" — los chips usan `<RowActions>` y el dropdown
 * "Copiar a..." sigue el patrón canónico.
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
      {/* Header del día: nombre + estado + switch. Siempre visible. */}
      <div
        className={`flex min-h-[56px] items-center gap-3 px-3 ${isOn ? 'border-b border-neutral-200' : ''}`}
      >
        <span className="flex-1 text-base font-medium text-neutral-900">{dayName}</span>
        <span className="text-xs text-neutral-500">{isOn ? 'Abierto' : 'Cerrado'}</span>
        <DaySwitch
          isOn={isOn}
          dayName={dayName}
          onToggle={(next) => {
            if (next) onAddWindow()
            else onToggleOff()
          }}
        />
      </div>

      {/* Body solo se renderea cuando hay ventanas. Layout vertical (no chips
          horizontales) — en mobile evita el wrap denso del DayRow anterior. */}
      {isOn ? (
        <div className="space-y-2 px-3 py-3">
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

          {/* Acciones inline visibles: + Agregar ventana (primary affordance)
              y un dropdown explícito "Copiar a otros días" — antes vivía
              escondido en el menú overflow de 3-dots. */}
          <button
            type="button"
            onClick={onAddWindow}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 px-4 text-sm font-medium text-neutral-600 hover:border-neutral-500"
          >
            <span aria-hidden="true">+</span> Agregar ventana
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm text-neutral-600 hover:bg-neutral-100"
                aria-label={`Copiar ${dayName} a otros días`}
              >
                Copiar a otros días…
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onCopyToAll}>Copiar a todos los días</DropdownMenuItem>
              <DropdownMenuItem onSelect={onCopyToWeekdays}>
                Copiar a días de semana
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onCopyToWeekend}>Copiar a fin de semana</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
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
