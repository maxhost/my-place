'use client'

import { useEffect } from 'react'
import {
  LIBRARY_READ_ACCESS_KIND_VALUES,
  type LibraryReadAccessKind,
} from '@/features/library/public'
import type { WizardStepProps } from '@/shared/ui/wizard'
import { SearchableMultiSelect } from '@/shared/ui/searchable-multi-select'
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
        <SearchableMultiSelect
          label="Grupos con acceso"
          options={sortedGroups.map((g) => ({
            id: g.id,
            label: g.name,
            badge: g.isPreset ? 'preset' : null,
          }))}
          selected={value.readAccessGroupIds}
          forced={value.writeAccessKind === 'GROUPS' ? value.writeAccessGroupIds : []}
          forcedHint="Las entradas con acceso de escritura ya tienen lectura automáticamente."
          onChange={(next) => onChange({ ...value, readAccessGroupIds: next })}
          placeholder="Buscar grupo…"
          noOptionsLabel="Este place no tiene grupos creados todavía."
        />
      ) : null}

      {value.readAccessKind === 'TIERS' ? (
        <SearchableMultiSelect
          label="Tiers con acceso"
          options={sortedTiers.map((t) => ({ id: t.id, label: t.name }))}
          selected={value.readAccessTierIds}
          forced={value.writeAccessKind === 'TIERS' ? value.writeAccessTierIds : []}
          forcedHint="Los tiers con acceso de escritura ya tienen lectura automáticamente."
          onChange={(next) => onChange({ ...value, readAccessTierIds: next })}
          placeholder="Buscar tier…"
          noOptionsLabel="Este place no tiene tiers creados todavía."
        />
      ) : null}

      {value.readAccessKind === 'USERS' ? (
        <SearchableMultiSelect
          label="Personas con acceso"
          options={sortedMembers.map((m) => ({
            id: m.userId,
            label: m.displayName,
            sublabel: m.handle ? `@${m.handle}` : null,
            searchable: m.handle ? `${m.displayName} @${m.handle}` : m.displayName,
          }))}
          selected={value.readAccessUserIds}
          forced={value.writeAccessKind === 'USERS' ? value.writeAccessUserIds : []}
          forcedHint="Las personas con acceso de escritura ya tienen lectura automáticamente."
          onChange={(next) => onChange({ ...value, readAccessUserIds: next })}
          placeholder="Buscar por nombre o handle…"
          noOptionsLabel="Este place no tiene miembros activos todavía."
        />
      ) : null}
    </div>
  )
}
