'use client'

import { useEffect } from 'react'
import {
  LIBRARY_READ_ACCESS_KIND_VALUES,
  type LibraryReadAccessKind,
} from '@/features/library/public'
import type { WizardStepProps } from '@/shared/ui/wizard'
import { useCategoryFormCatalogs, type CategoryFormValue } from './category-form-types'

/**
 * Step 3: acceso de lectura (quién puede VER el contenido).
 *
 * Discriminator único (PUBLIC / GROUPS / TIERS / USERS) + sub-picker
 * condicional según el kind elegido. Decisión #C3 (sesión 2026-05-04) +
 * D6 ADR.
 *
 * Nota UX: las categorías SIEMPRE se listan para todos los miembros
 * activos. El gating ocurre al ABRIR un item — el copy aclara esto para
 * que el owner entienda qué está cambiando.
 *
 * **Write implica read** (S2, 2026-05-13): cuando el kind del read step
 * coincide con el del write step, los IDs del write scope aparecen
 * pre-checked en read (forzados, no se pueden destildar). El owner ve
 * un hint "ya tiene read por write access". Decisión user 2026-05-12.
 *
 * Backend semantics: el helper `canRead` permite acceso a quien matchea
 * read scope O write scope (write implica read implícito en query). La
 * UI lo previsualiza forzando los checkboxes para que el owner entienda
 * el efecto final.
 *
 * Validación: PUBLIC siempre válido. GROUPS/TIERS/USERS válidos aún con
 * set vacío (default cerrado seguro — nadie no-owner verá hasta que el
 * owner asigne).
 */
const READ_ACCESS_LABEL: Record<LibraryReadAccessKind, string> = {
  PUBLIC: 'Cualquier miembro',
  GROUPS: 'Grupos seleccionados',
  TIERS: 'Tiers seleccionados',
  USERS: 'Personas seleccionadas',
}

const READ_ACCESS_DESCRIPTION: Record<LibraryReadAccessKind, string> = {
  PUBLIC: 'Cualquier miembro activo del place puede ver el contenido.',
  GROUPS: 'Sólo miembros de los grupos seleccionados pueden ver el contenido.',
  TIERS: 'Sólo miembros con tier activo seleccionado pueden ver el contenido.',
  USERS: 'Sólo las personas seleccionadas pueden ver el contenido.',
}

export function CategoryFormStepReadAccess({
  value,
  onChange,
  onValid,
}: WizardStepProps<CategoryFormValue>): React.ReactNode {
  const { groups, tiers, members } = useCategoryFormCatalogs()

  useEffect(() => {
    onValid(true)
  }, [onValid])

  const sortedGroups = [...groups].sort((a, b) => {
    if (a.isPreset && !b.isPreset) return -1
    if (!a.isPreset && b.isPreset) return 1
    return a.name.localeCompare(b.name)
  })
  const sortedTiers = [...tiers].sort((a, b) => a.name.localeCompare(b.name))
  const sortedMembers = [...members].sort((a, b) => a.displayName.localeCompare(b.displayName))

  function setKind(next: LibraryReadAccessKind): void {
    onChange({ ...value, readAccessKind: next })
  }

  function toggleId(set: ReadonlyArray<string>, id: string): string[] {
    const s = new Set(set)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    return Array.from(s)
  }

  return (
    <div className="space-y-4 py-2">
      <label className="block">
        <span className="mb-1 block text-sm text-neutral-600">Quién puede ver el contenido</span>
        <select
          value={value.readAccessKind}
          onChange={(e) => setKind(e.target.value as LibraryReadAccessKind)}
          className="block min-h-[44px] w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base focus:border-neutral-500 focus:outline-none"
        >
          {LIBRARY_READ_ACCESS_KIND_VALUES.map((k) => (
            <option key={k} value={k}>
              {READ_ACCESS_LABEL[k]}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-neutral-600">
          {READ_ACCESS_DESCRIPTION[value.readAccessKind]} La categoría siempre se lista para todos —
          el gating sucede al abrir un item.
        </span>
      </label>

      {value.readAccessKind === 'GROUPS' ? (
        <ScopeFieldset
          label="Grupos con acceso"
          options={sortedGroups.map((g) => ({
            id: g.id,
            label: g.name,
            badge: g.isPreset ? 'preset' : null,
          }))}
          selected={value.readAccessGroupIds}
          forced={value.writeAccessKind === 'GROUPS' ? value.writeAccessGroupIds : []}
          empty="Este place no tiene grupos creados todavía."
          onToggle={(id) =>
            onChange({ ...value, readAccessGroupIds: toggleId(value.readAccessGroupIds, id) })
          }
        />
      ) : null}

      {value.readAccessKind === 'TIERS' ? (
        <ScopeFieldset
          label="Tiers con acceso"
          options={sortedTiers.map((t) => ({ id: t.id, label: t.name, badge: null }))}
          selected={value.readAccessTierIds}
          forced={value.writeAccessKind === 'TIERS' ? value.writeAccessTierIds : []}
          empty="Este place no tiene tiers creados todavía."
          onToggle={(id) =>
            onChange({ ...value, readAccessTierIds: toggleId(value.readAccessTierIds, id) })
          }
        />
      ) : null}

      {value.readAccessKind === 'USERS' ? (
        <ScopeFieldset
          label="Personas con acceso"
          options={sortedMembers.map((m) => ({
            id: m.userId,
            label: m.handle ? `${m.displayName} · @${m.handle}` : m.displayName,
            badge: null,
          }))}
          selected={value.readAccessUserIds}
          forced={value.writeAccessKind === 'USERS' ? value.writeAccessUserIds : []}
          empty="Este place no tiene miembros activos todavía."
          onToggle={(id) =>
            onChange({ ...value, readAccessUserIds: toggleId(value.readAccessUserIds, id) })
          }
        />
      ) : null}
    </div>
  )
}

type ScopeOption = { id: string; label: string; badge: string | null }

function ScopeFieldset({
  label,
  options,
  selected,
  forced,
  empty,
  onToggle,
}: {
  label: string
  options: ReadonlyArray<ScopeOption>
  selected: ReadonlyArray<string>
  /**
   * IDs forzados como checked + disabled. Provienen del write scope del
   * mismo kind — write implica read, no se permite destildar.
   */
  forced: ReadonlyArray<string>
  empty: string
  onToggle: (id: string) => void
}): React.ReactNode {
  const set = new Set(selected)
  const forcedSet = new Set(forced)
  const effectiveCount = new Set([...set, ...forcedSet]).size
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 block text-sm text-neutral-600">
        {label} ({effectiveCount} con acceso)
      </legend>
      {forcedSet.size > 0 ? (
        <p className="text-xs italic text-neutral-500">
          {forcedSet.size === 1 ? '1 entrada con' : `${forcedSet.size} entradas con`} acceso de
          escritura — ya tienen lectura automáticamente.
        </p>
      ) : null}
      {options.length === 0 ? (
        <p className="text-sm italic text-neutral-500">{empty}</p>
      ) : (
        <div className="divide-y divide-neutral-200 border-y border-neutral-200">
          {options.map((o) => {
            const isForced = forcedSet.has(o.id)
            const checked = isForced || set.has(o.id)
            return (
              <label
                key={o.id}
                className={`flex min-h-11 items-center gap-3 py-2 ${
                  isForced ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isForced}
                  onChange={() => onToggle(o.id)}
                  className="h-4 w-4"
                />
                <span className="flex-1 text-sm">
                  {o.label}
                  {o.badge ? (
                    <span className="ml-2 rounded-full border border-amber-300 px-2 py-0.5 text-[11px] text-amber-700">
                      {o.badge}
                    </span>
                  ) : null}
                  {isForced ? (
                    <span className="ml-2 rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600">
                      por escritura
                    </span>
                  ) : null}
                </span>
              </label>
            )
          })}
        </div>
      )}
    </fieldset>
  )
}
