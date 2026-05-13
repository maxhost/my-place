'use client'

import { useEffect } from 'react'
import { WRITE_ACCESS_KIND_VALUES, type WriteAccessKind } from '@/features/library/public'
import type { WizardStepProps } from '@/shared/ui/wizard'
import { useCategoryFormCatalogs, type CategoryFormValue } from './category-form-types'

/**
 * Step 2: acceso de escritura (quién puede CREAR items en la categoría).
 *
 * Discriminator único (OWNER_ONLY / GROUPS / TIERS / USERS) + sub-picker
 * condicional. Simétrico al step Lectura — sumado en S2
 * (`docs/plans/2026-05-12-library-permissions-redesign.md`).
 *
 * **Write implica read** (decisión user 2026-05-12): si el owner elige
 * "X tier/group/user puede escribir", X aparece pre-checkeado en el step
 * Lectura siguiente (cuando el kind del read step coincide con el del
 * write step). Implementación: el step-read-access lee los IDs del scope
 * de escritura desde `value.writeAccess*Ids` y los mergea con
 * `value.readAccess*Ids` al mostrar el checkbox. Ver
 * `category-form-step-read-access.tsx` § "Write implica read".
 *
 * Owner siempre puede escribir (bypass). El opción `OWNER_ONLY` indica
 * que sólo el owner crea — análoga al `PUBLIC` del read scope (default
 * extremo, no requiere set).
 *
 * Validación: cualquier kind con cualquier set (incluso vacío) es válido.
 * Set vacío + kind=GROUPS/TIERS/USERS = "sólo owner" efectivo (default
 * cerrado seguro hasta que el owner asigne).
 */
const WRITE_ACCESS_LABEL: Record<WriteAccessKind, string> = {
  OWNER_ONLY: 'Solo el owner',
  GROUPS: 'Grupos seleccionados',
  TIERS: 'Tiers seleccionados',
  USERS: 'Personas seleccionadas',
}

const WRITE_ACCESS_DESCRIPTION: Record<WriteAccessKind, string> = {
  OWNER_ONLY: 'Sólo vos (owner) podés crear contenido en esta categoría.',
  GROUPS: 'Sólo miembros de los grupos seleccionados pueden crear contenido.',
  TIERS: 'Sólo miembros con tier activo seleccionado pueden crear contenido.',
  USERS: 'Sólo las personas seleccionadas pueden crear contenido.',
}

export function CategoryFormStepWriteAccess({
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

  function setKind(next: WriteAccessKind): void {
    onChange({ ...value, writeAccessKind: next })
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
        <span className="mb-1 block text-sm text-neutral-600">Quién puede crear contenido</span>
        <select
          value={value.writeAccessKind}
          onChange={(e) => setKind(e.target.value as WriteAccessKind)}
          className="block min-h-[44px] w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base focus:border-neutral-500 focus:outline-none"
        >
          {WRITE_ACCESS_KIND_VALUES.map((k) => (
            <option key={k} value={k}>
              {WRITE_ACCESS_LABEL[k]}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-neutral-600">
          {WRITE_ACCESS_DESCRIPTION[value.writeAccessKind]} Vos siempre podés crear contenido (owner
          bypass).
        </span>
      </label>

      {value.writeAccessKind === 'GROUPS' ? (
        <ScopeFieldset
          label="Grupos con permiso para crear"
          options={sortedGroups.map((g) => ({
            id: g.id,
            label: g.name,
            badge: g.isPreset ? 'preset' : null,
          }))}
          selected={value.writeAccessGroupIds}
          empty="Este place no tiene grupos creados todavía."
          onToggle={(id) =>
            onChange({ ...value, writeAccessGroupIds: toggleId(value.writeAccessGroupIds, id) })
          }
        />
      ) : null}

      {value.writeAccessKind === 'TIERS' ? (
        <ScopeFieldset
          label="Tiers con permiso para crear"
          options={sortedTiers.map((t) => ({ id: t.id, label: t.name, badge: null }))}
          selected={value.writeAccessTierIds}
          empty="Este place no tiene tiers creados todavía."
          onToggle={(id) =>
            onChange({ ...value, writeAccessTierIds: toggleId(value.writeAccessTierIds, id) })
          }
        />
      ) : null}

      {value.writeAccessKind === 'USERS' ? (
        <ScopeFieldset
          label="Personas con permiso para crear"
          options={sortedMembers.map((m) => ({
            id: m.userId,
            label: m.handle ? `${m.displayName} · @${m.handle}` : m.displayName,
            badge: null,
          }))}
          selected={value.writeAccessUserIds}
          empty="Este place no tiene miembros activos todavía."
          onToggle={(id) =>
            onChange({ ...value, writeAccessUserIds: toggleId(value.writeAccessUserIds, id) })
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
  empty,
  onToggle,
}: {
  label: string
  options: ReadonlyArray<ScopeOption>
  selected: ReadonlyArray<string>
  empty: string
  onToggle: (id: string) => void
}): React.ReactNode {
  const set = new Set(selected)
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 block text-sm text-neutral-600">
        {label} ({set.size} seleccionados)
      </legend>
      {options.length === 0 ? (
        <p className="text-sm italic text-neutral-500">{empty}</p>
      ) : (
        <div className="divide-y divide-neutral-200 border-y border-neutral-200">
          {options.map((o) => {
            const checked = set.has(o.id)
            return (
              <label key={o.id} className="flex min-h-11 cursor-pointer items-center gap-3 py-2">
                <input
                  type="checkbox"
                  checked={checked}
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
                </span>
              </label>
            )
          })}
        </div>
      )}
    </fieldset>
  )
}
