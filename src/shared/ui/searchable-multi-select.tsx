'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'

/**
 * Multi-select combobox con búsqueda incremental.
 *
 * **Cuándo usar.** Pickers de muchos items (usuarios, grupos, tiers,
 * tags) donde un listado plano de checkboxes empujaría el footer fuera
 * del viewport. Permite al user filtrar tipeando y ver solo los matches
 * + sus seleccionados como chips. Ahorra espacio vertical, sobre todo
 * en bottom sheet mobile.
 *
 * **Comportamiento:**
 *  - Chips arriba con los seleccionados (X para remover, lock para los
 *    forzados).
 *  - Input de búsqueda — focus abre dropdown filtrado.
 *  - Click en opción del dropdown → toggle selection. Sigue abierto
 *    para multi-select rápido.
 *  - Click outside / ESC → cierra dropdown.
 *  - Match case-insensitive contra `label`, `sublabel` y `searchable`
 *    (custom field).
 *
 * **`forced` IDs:** chips que están siempre marcados y NO se pueden
 * destildar (e.g. write-implies-read en library admin). Se renderizan
 * con candado en vez de X.
 *
 * **A11y:**
 *  - `aria-haspopup="listbox"` + `aria-expanded` en el input.
 *  - `role="listbox"` en el dropdown + `role="option"` por item.
 *  - `aria-selected` por opción.
 *  - Focus trap NO — el dropdown se cierra al perder focus (click
 *    outside del wrapper).
 *
 * **Keyboard nav** (mínimo viable v1):
 *  - ESC: cierra dropdown.
 *  - Click only para seleccionar (no arrow keys / enter en v1 —
 *    suficiente para typical Settings flow donde el user busca por
 *    texto y clickea).
 *
 * **Cierre explícito en mobile (S5.2, 2026-05-13):** botón "Listo"
 * sticky al final del dropdown. En mobile bottom sheet, el dropdown
 * llena la mayoría del viewport y no hay área tappable fuera del
 * fieldset wrapper — el listener `click outside` queda sin target
 * útil. El "Listo" garantiza un affordance de cierre siempre visible.
 */

export type MultiSelectOption = {
  id: string
  /** Texto principal visible (display name, nombre del grupo, etc.). */
  label: string
  /** Texto secundario (handle, email, descriptor del tier). */
  sublabel?: string | null
  /** Badge corto opcional (e.g. "preset"). */
  badge?: string | null
  /** Texto adicional para matching (no se renderiza). Se combina con
   *  label y sublabel para el filtro case-insensitive. */
  searchable?: string
}

type Props = {
  /** Label visible arriba del input. También aria-label del input. */
  label: string
  /** Lista completa de opciones disponibles. */
  options: ReadonlyArray<MultiSelectOption>
  /** IDs actualmente seleccionados (controlled). */
  selected: ReadonlyArray<string>
  /** IDs siempre marcados + bloqueados. Útil para write-implies-read.
   *  Visualmente aparecen como chips con candado. NO disparan onChange
   *  cuando se intenta quitar. */
  forced?: ReadonlyArray<string>
  /** Hint mostrado debajo cuando hay forced IDs. */
  forcedHint?: string
  /** Sumar `id` al set. */
  onChange: (nextIds: ReadonlyArray<string>) => void
  /** Texto del input cuando está vacío. */
  placeholder?: string
  /** Mensaje cuando el filtro no matchea ninguna opción. */
  emptyLabel?: string
  /** Mensaje cuando NO hay opciones totales (catalog vacío). */
  noOptionsLabel?: string
}

export function SearchableMultiSelect({
  label,
  options,
  selected,
  forced = [],
  forcedHint,
  onChange,
  placeholder = 'Buscar…',
  emptyLabel = 'Sin resultados',
  noOptionsLabel = 'No hay opciones disponibles.',
}: Props): React.JSX.Element {
  const inputId = useId()
  const listboxId = `${inputId}-listbox`
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLFieldSetElement | null>(null)

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const forcedSet = useMemo(() => new Set(forced), [forced])
  const optionsById = useMemo(() => new Map(options.map((o) => [o.id, o])), [options])

  // Effective IDs = selected ∪ forced. Dedupe.
  const effectiveIds = useMemo(() => {
    const set = new Set<string>(forced)
    for (const id of selected) set.add(id)
    return Array.from(set)
  }, [selected, forced])

  // Chips visibles arriba — preserva orden: forced primero, después selected.
  const chips = useMemo(() => {
    const seen = new Set<string>()
    const ordered: Array<MultiSelectOption & { isForced: boolean }> = []
    for (const id of forced) {
      const opt = optionsById.get(id)
      if (opt && !seen.has(id)) {
        ordered.push({ ...opt, isForced: true })
        seen.add(id)
      }
    }
    for (const id of selected) {
      if (seen.has(id)) continue
      const opt = optionsById.get(id)
      if (opt) {
        ordered.push({ ...opt, isForced: false })
        seen.add(id)
      }
    }
    return ordered
  }, [forced, selected, optionsById])

  // Lista filtrada: filtra por query (case-insensitive). Ordena seleccionados
  // arriba para feedback visual rápido.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const haystack = (o: MultiSelectOption): string =>
      [o.label, o.sublabel ?? '', o.searchable ?? ''].join(' ').toLowerCase()
    const matches = q.length === 0 ? options : options.filter((o) => haystack(o).includes(q))
    return [...matches].sort((a, b) => {
      const aSel = selectedSet.has(a.id) || forcedSet.has(a.id)
      const bSel = selectedSet.has(b.id) || forcedSet.has(b.id)
      if (aSel && !bSel) return -1
      if (!aSel && bSel) return 1
      return a.label.localeCompare(b.label)
    })
  }, [options, query, selectedSet, forcedSet])

  // Click outside cierra el dropdown.
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent): void {
      const target = e.target
      if (wrapperRef.current && target instanceof Node && !wrapperRef.current.contains(target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  function toggle(id: string): void {
    if (forcedSet.has(id)) return // forced no se puede destildar
    if (selectedSet.has(id)) {
      onChange(selected.filter((x) => x !== id))
    } else {
      onChange([...selected, id])
    }
  }

  function removeChip(id: string): void {
    if (forcedSet.has(id)) return
    onChange(selected.filter((x) => x !== id))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  if (options.length === 0) {
    return (
      <fieldset className="space-y-2">
        <legend className="mb-1 block text-sm text-neutral-600">{label}</legend>
        <p className="text-sm italic text-neutral-500">{noOptionsLabel}</p>
      </fieldset>
    )
  }

  return (
    <fieldset className="space-y-2" ref={wrapperRef}>
      <legend className="mb-1 block text-sm text-neutral-600">
        {label} ({effectiveIds.length} con acceso)
      </legend>

      {forcedHint && forced.length > 0 ? (
        <p className="text-xs italic text-neutral-500">{forcedHint}</p>
      ) : null}

      {chips.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <li
              key={chip.id}
              className="inline-flex items-center gap-1 rounded-full border border-neutral-300 bg-neutral-50 py-0.5 pl-2 pr-1 text-[11px] text-neutral-700"
            >
              <span className="truncate">{chip.label}</span>
              {chip.isForced ? (
                <span
                  aria-label="Bloqueado por permiso de escritura"
                  className="inline-flex h-5 w-5 items-center justify-center text-neutral-500"
                  title="Tiene acceso por escritura — no se puede quitar"
                >
                  <LockIcon />
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`Quitar ${chip.label}`}
                  onClick={() => removeChip(chip.id)}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-200"
                >
                  <CloseIcon />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-label={label}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="block min-h-[44px] w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base focus:border-neutral-500 focus:outline-none"
        />

        {open ? (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 flex max-h-64 flex-col overflow-hidden rounded-md border border-neutral-300 bg-white shadow-lg">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm italic text-neutral-500">{emptyLabel}</p>
            ) : (
              <ul
                id={listboxId}
                role="listbox"
                aria-multiselectable="true"
                className="flex-1 overflow-y-auto"
              >
                {filtered.map((opt) => {
                  const isForced = forcedSet.has(opt.id)
                  const isChecked = isForced || selectedSet.has(opt.id)
                  return (
                    <li
                      key={opt.id}
                      role="option"
                      aria-selected={isChecked}
                      aria-disabled={isForced}
                      onClick={() => toggle(opt.id)}
                      className={`flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-neutral-50 ${
                        isForced ? 'opacity-70' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        readOnly
                        disabled={isForced}
                        aria-hidden="true"
                        tabIndex={-1}
                        className="h-4 w-4"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-neutral-900">{opt.label}</span>
                        {opt.sublabel ? (
                          <span className="block truncate text-xs text-neutral-500">
                            {opt.sublabel}
                          </span>
                        ) : null}
                      </span>
                      {opt.badge ? (
                        <span className="shrink-0 rounded-full border border-amber-300 px-2 py-0.5 text-[11px] text-amber-700">
                          {opt.badge}
                        </span>
                      ) : null}
                      {isForced ? (
                        <span
                          aria-hidden="true"
                          className="shrink-0 text-neutral-400"
                          title="Tiene acceso por escritura"
                        >
                          <LockIcon />
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
            {/* Footer sticky con CTA explícito de cierre. Crítico en mobile
                bottom sheet donde el dropdown llena casi todo el viewport
                y no hay área tappable fuera del fieldset. */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0 border-t border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
            >
              Listo
            </button>
          </div>
        ) : null}
      </div>
    </fieldset>
  )
}

function CloseIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function LockIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}
