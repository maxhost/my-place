import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

vi.mock('@/shared/config/env', () => ({
  serverEnv: { NODE_ENV: 'test' },
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    NEXT_PUBLIC_APP_URL: 'http://lvh.me:3000',
    NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000',
  },
}))
vi.mock('server-only', () => ({}))

import { CategoryFormStepReadAccess } from '../ui/wizard/category-form-step-read-access'
import {
  CategoryFormCatalogContext,
  type CategoryFormCatalogs,
  type CategoryFormValue,
} from '../ui/wizard/category-form-types'

/**
 * Tests del step "Lectura" — verifica el feature `write implica read`
 * sumado en S2 (decisión user 2026-05-12).
 *
 * Regla: cuando `readAccessKind === writeAccessKind` y el write scope
 * tiene IDs, esos IDs aparecen pre-checked + disabled en el picker de
 * read (forzados — owner no puede destildar). Hint visual "X tiene
 * acceso por escritura".
 *
 * Cuando los kinds NO coinciden, el pre-check NO aplica (read tiene su
 * propio set independiente).
 */

const CATALOG_FIXTURE: CategoryFormCatalogs = {
  groups: [
    { id: 'g-admin', name: 'Administradores', isPreset: true },
    { id: 'g-mods', name: 'Mods', isPreset: false },
  ],
  tiers: [
    { id: 't-pro', name: 'Pro' },
    { id: 't-basic', name: 'Basic' },
  ],
  members: [
    { userId: 'u-alice', displayName: 'Alice', handle: 'alice' },
    { userId: 'u-bob', displayName: 'Bob', handle: null },
  ],
}

function baseValue(overrides: Partial<CategoryFormValue> = {}): CategoryFormValue {
  return {
    emoji: '📚',
    title: 'Onboarding',
    writeAccessKind: 'OWNER_ONLY',
    writeAccessGroupIds: [],
    writeAccessTierIds: [],
    writeAccessUserIds: [],
    readAccessKind: 'PUBLIC',
    readAccessGroupIds: [],
    readAccessTierIds: [],
    readAccessUserIds: [],
    kind: 'GENERAL',
    ...overrides,
  }
}

function renderStep(value: CategoryFormValue) {
  const onChange = vi.fn()
  const onValid = vi.fn()
  render(
    <CategoryFormCatalogContext.Provider value={CATALOG_FIXTURE}>
      <CategoryFormStepReadAccess value={value} onChange={onChange} onValid={onValid} />
    </CategoryFormCatalogContext.Provider>,
  )
  return { onChange, onValid }
}

afterEach(() => cleanup())

describe('CategoryFormStepReadAccess — write implica read (USERS = USERS)', () => {
  it('writeAccessKind=USERS con u-alice + readAccessKind=USERS: u-alice forzado checked+disabled', () => {
    renderStep(
      baseValue({
        writeAccessKind: 'USERS',
        writeAccessUserIds: ['u-alice'],
        readAccessKind: 'USERS',
        readAccessUserIds: [],
      }),
    )
    const aliceCheckbox = screen.getByRole('checkbox', { name: /Alice/i }) as HTMLInputElement
    expect(aliceCheckbox.checked).toBe(true)
    expect(aliceCheckbox.disabled).toBe(true)

    // Hint visible: "por escritura" badge sobre Alice.
    const aliceLabel = aliceCheckbox.closest('label')!
    expect(within(aliceLabel).getByText(/por escritura/i)).toBeInTheDocument()
  })

  it('write USERS + read GROUPS (kinds distintos): u-alice NO forzado en el step read', () => {
    renderStep(
      baseValue({
        writeAccessKind: 'USERS',
        writeAccessUserIds: ['u-alice'],
        readAccessKind: 'GROUPS',
      }),
    )
    // El picker visible es Grupos — los user-forced no aplican acá.
    expect(screen.getByText(/Grupos con acceso/i)).toBeInTheDocument()
    // Ningún checkbox debe estar disabled (no hay forced en groups).
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes.every((c) => !c.disabled)).toBe(true)
  })

  it('user en el read set además del write set: muestra contador "con acceso" único', () => {
    renderStep(
      baseValue({
        writeAccessKind: 'USERS',
        writeAccessUserIds: ['u-alice'],
        readAccessKind: 'USERS',
        readAccessUserIds: ['u-bob'],
      }),
    )
    // Alice (write) + Bob (read explicito) = 2 con acceso.
    expect(screen.getByText(/2 con acceso/i)).toBeInTheDocument()
  })

  it('user en AMBOS sets: dedupe (no se cuenta 2 veces)', () => {
    renderStep(
      baseValue({
        writeAccessKind: 'USERS',
        writeAccessUserIds: ['u-alice'],
        readAccessKind: 'USERS',
        readAccessUserIds: ['u-alice', 'u-bob'],
      }),
    )
    // Alice (en write + read) + Bob (read) = 2 únicos.
    expect(screen.getByText(/2 con acceso/i)).toBeInTheDocument()
  })
})

describe('CategoryFormStepReadAccess — write implica read (GROUPS = GROUPS)', () => {
  it('writeAccessKind=GROUPS con g-mods + readAccessKind=GROUPS: g-mods forzado', () => {
    renderStep(
      baseValue({
        writeAccessKind: 'GROUPS',
        writeAccessGroupIds: ['g-mods'],
        readAccessKind: 'GROUPS',
        readAccessGroupIds: [],
      }),
    )
    const modsCheckbox = screen.getByRole('checkbox', { name: /Mods/i }) as HTMLInputElement
    expect(modsCheckbox.checked).toBe(true)
    expect(modsCheckbox.disabled).toBe(true)
  })

  it('hint visible: "N entradas con acceso de escritura"', () => {
    renderStep(
      baseValue({
        writeAccessKind: 'GROUPS',
        writeAccessGroupIds: ['g-mods', 'g-admin'],
        readAccessKind: 'GROUPS',
      }),
    )
    expect(screen.getByText(/2 entradas con\s+acceso de escritura/i)).toBeInTheDocument()
  })
})

describe('CategoryFormStepReadAccess — sin write scope, sin pre-check', () => {
  it('writeAccessKind=OWNER_ONLY: no afecta read step (no forced)', () => {
    renderStep(
      baseValue({
        writeAccessKind: 'OWNER_ONLY',
        readAccessKind: 'USERS',
        readAccessUserIds: ['u-alice'],
      }),
    )
    const aliceCheckbox = screen.getByRole('checkbox', { name: /Alice/i }) as HTMLInputElement
    expect(aliceCheckbox.checked).toBe(true)
    expect(aliceCheckbox.disabled).toBe(false)
  })

  it('write GROUPS con set vacío + read GROUPS: no hay forced', () => {
    renderStep(
      baseValue({
        writeAccessKind: 'GROUPS',
        writeAccessGroupIds: [],
        readAccessKind: 'GROUPS',
      }),
    )
    // El hint "por escritura" no aparece en ningún checkbox.
    expect(screen.queryByText(/por escritura/i)).not.toBeInTheDocument()
  })
})
