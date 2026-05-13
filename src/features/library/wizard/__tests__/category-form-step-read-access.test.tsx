import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'

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
 * Tests del step "Lectura" — verifica el feature `write implica read`.
 *
 * Regla: cuando `readAccessKind === writeAccessKind` y el write scope
 * tiene IDs, esos IDs aparecen como chips con candado (forced) en el
 * picker de read. Picker = `<SearchableMultiSelect>` combobox.
 *
 * Cuando los kinds NO coinciden, el pre-check NO aplica.
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
  it('writeAccessKind=USERS con u-alice + readAccessKind=USERS: u-alice aparece como chip forced (lock)', () => {
    renderStep(
      baseValue({
        writeAccessKind: 'USERS',
        writeAccessUserIds: ['u-alice'],
        readAccessKind: 'USERS',
        readAccessUserIds: [],
      }),
    )
    // El chip de Alice debe aparecer con LockIcon (aria-label).
    expect(screen.getByLabelText(/Bloqueado por permiso de escritura/i)).toBeInTheDocument()
    // NO debe haber botón "Quitar Alice" — está forced.
    expect(screen.queryByRole('button', { name: /Quitar Alice/i })).not.toBeInTheDocument()
  })

  it('write USERS + read GROUPS (kinds distintos): u-alice NO forzado en read step', () => {
    renderStep(
      baseValue({
        writeAccessKind: 'USERS',
        writeAccessUserIds: ['u-alice'],
        readAccessKind: 'GROUPS',
      }),
    )
    // El picker visible es Grupos — no debe haber chips de Alice ni lock icon.
    expect(screen.getByRole('combobox', { name: /Grupos con acceso/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/Bloqueado por permiso de escritura/i)).not.toBeInTheDocument()
  })

  it('legend dedup: write + read incluyen mismo user → cuenta 1, no 2', () => {
    renderStep(
      baseValue({
        writeAccessKind: 'USERS',
        writeAccessUserIds: ['u-alice'],
        readAccessKind: 'USERS',
        readAccessUserIds: ['u-alice', 'u-bob'],
      }),
    )
    // Alice (write+read) + Bob (read solo) = 2 únicos.
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
    // Chip de Mods aparece con candado.
    expect(screen.getByLabelText(/Bloqueado por permiso de escritura/i)).toBeInTheDocument()
  })

  it('forcedHint visible cuando hay forced IDs', () => {
    renderStep(
      baseValue({
        writeAccessKind: 'GROUPS',
        writeAccessGroupIds: ['g-mods', 'g-admin'],
        readAccessKind: 'GROUPS',
      }),
    )
    // Hint canónico del primitive.
    expect(
      screen.getByText(/acceso de escritura ya tienen lectura automáticamente/i),
    ).toBeInTheDocument()
  })
})

describe('CategoryFormStepReadAccess — sin write scope, sin forced', () => {
  it('writeAccessKind=OWNER_ONLY: no afecta read step (no forced)', () => {
    renderStep(
      baseValue({
        writeAccessKind: 'OWNER_ONLY',
        readAccessKind: 'USERS',
        readAccessUserIds: ['u-alice'],
      }),
    )
    // Alice aparece como chip removable (botón Quitar), no como forced.
    expect(screen.getByRole('button', { name: /Quitar Alice/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/Bloqueado por permiso de escritura/i)).not.toBeInTheDocument()
  })

  it('write GROUPS con set vacío + read GROUPS: no hay forced', () => {
    renderStep(
      baseValue({
        writeAccessKind: 'GROUPS',
        writeAccessGroupIds: [],
        readAccessKind: 'GROUPS',
      }),
    )
    expect(screen.queryByLabelText(/Bloqueado por permiso de escritura/i)).not.toBeInTheDocument()
    // No hay hint visible cuando forced.length=0.
    expect(
      screen.queryByText(/acceso de escritura ya tienen lectura automáticamente/i),
    ).not.toBeInTheDocument()
  })
})

describe('CategoryFormStepReadAccess — toggle via dropdown click', () => {
  it('USERS: click en opción Bob (no seleccionada) agrega al set', () => {
    const { onChange } = renderStep(
      baseValue({
        readAccessKind: 'USERS',
        readAccessUserIds: ['u-alice'],
      }),
    )
    const input = screen.getByRole('combobox', { name: /Personas con acceso/i })
    fireEvent.focus(input)
    fireEvent.click(screen.getByRole('option', { name: /Bob/i }))
    const next = onChange.mock.calls[0]![0] as CategoryFormValue
    expect(next.readAccessUserIds).toEqual(['u-alice', 'u-bob'])
  })
})
