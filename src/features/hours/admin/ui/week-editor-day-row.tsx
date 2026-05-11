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
 * Fila de un día con sus chips de ventana + menú overflow.
 *
 * Cada chip es un dropdown trigger con acciones inline (Editar / Eliminar).
 * El menú overflow del día agrupa: agregar otra ventana al mismo día y copiar
 * a otros días (todos / días de semana / fin de semana).
 *
 * Sólo se renderiza para días que tienen al menos una ventana — el orquestador
 * (`WeekEditor`) filtra `presentDays` antes de mapear.
 */

type Props = {
  day: DayOfWeek
  windows: IndexedWindow[]
  onAddWindow: () => void
  onEditWindow: (w: IndexedWindow) => void
  onRemoveWindow: (idx: number) => void
  onCopyToAll: () => void
  onCopyToWeekdays: () => void
  onCopyToWeekend: () => void
}

export function DayRow({
  day,
  windows,
  onAddWindow,
  onEditWindow,
  onRemoveWindow,
  onCopyToAll,
  onCopyToWeekdays,
  onCopyToWeekend,
}: Props) {
  return (
    <li className="flex min-h-[56px] items-center gap-2 py-2">
      <span className="w-20 shrink-0 text-base font-medium">{DAY_ES[day]}</span>

      <div className="flex flex-1 flex-wrap items-center gap-1.5">
        {windows.map((w) => (
          <RowActions
            key={w.id}
            // aria-label usa `HH:MM` 24h raw (canónico del schema) —
            // determinístico entre server y client. Si usáramos `formatTime()`,
            // el ICU de Node (Vercel) vs el del browser puede diferir por
            // non-breaking spaces o variantes de locale, causando hydration
            // mismatch en el atributo (donde `suppressHydrationWarning` no aplica).
            triggerLabel={`Opciones para ventana ${w.start} a ${w.end} del ${DAY_ES[day]}`}
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
            {/* Visible: formato locale-aware. `suppressHydrationWarning`
                funciona acá porque es contenido textual, no atributo. */}
            <span suppressHydrationWarning>
              {formatTime(w.start)} → {formatTime(w.end)}
            </span>
          </RowActions>
        ))}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100"
            aria-label={`Opciones para ${DAY_ES[day]}`}
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
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onAddWindow}>Agregar otra ventana</DropdownMenuItem>
          <DropdownMenuItem onSelect={onCopyToAll}>Copiar a todos los días</DropdownMenuItem>
          <DropdownMenuItem onSelect={onCopyToWeekdays}>Copiar a días de semana</DropdownMenuItem>
          <DropdownMenuItem onSelect={onCopyToWeekend}>Copiar a fin de semana</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
