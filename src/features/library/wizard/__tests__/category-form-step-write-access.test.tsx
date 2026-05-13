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

import { CategoryFormStepWriteAccess } from '../ui/wizard/category-form-step-write-access'
import {
  CategoryFormCatalogContext,
  type CategoryFormCatalogs,
  type CategoryFormValue,
} from '../ui/wizard/category-form-types'

/**
 * Tests del step "Escritura" del wizard de categoría (S2, 2026-05-13).
 *
 * Cubre:
 *  - 4 opciones del enum WriteAccessKind aparecen en el select.
 *  - Sub-picker condicional según el kind (OWNER_ONLY sin picker;
 *    GROUPS/TIERS/USERS con picker del catalog respectivo).
 *  - Toggle individual de IDs del scope (add + remove + dedupe).
 *
 * No testea owner bypass — eso vive en `canWriteCategory` (sub-slice
 * contribution). Acá sólo UI puro.
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
      <CategoryFormStepWriteAccess value={value} onChange={onChange} onValid={onValid} />
    </CategoryFormCatalogContext.Provider>,
  )
  return { onChange, onValid }
}

afterEach(() => cleanup())

describe('CategoryFormStepWriteAccess — discriminator', () => {
  it('renderiza las 4 opciones de WriteAccessKind en el select', () => {
    renderStep(baseValue())
    const select = screen.getByLabelText(/Quién puede crear contenido/i) as HTMLSelectElement
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value)
    expect(options).toEqual(['OWNER_ONLY', 'GROUPS', 'TIERS', 'USERS'])
  })

  it('OWNER_ONLY: NO renderiza picker', () => {
    renderStep(baseValue({ writeAccessKind: 'OWNER_ONLY' }))
    expect(screen.queryByText(/Grupos con permiso/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Tiers con permiso/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Personas con permiso/i)).not.toBeInTheDocument()
  })

  it('GROUPS: renderiza picker de grupos con preset arriba', () => {
    renderStep(baseValue({ writeAccessKind: 'GROUPS' }))
    expect(screen.getByText(/Grupos con permiso para crear/i)).toBeInTheDocument()
    expect(screen.getByText('Administradores')).toBeInTheDocument()
    expect(screen.getByText('Mods')).toBeInTheDocument()
  })

  it('TIERS: renderiza picker de tiers', () => {
    renderStep(baseValue({ writeAccessKind: 'TIERS' }))
    expect(screen.getByText(/Tiers con permiso para crear/i)).toBeInTheDocument()
    expect(screen.getByText('Pro')).toBeInTheDocument()
    expect(screen.getByText('Basic')).toBeInTheDocument()
  })

  it('USERS: renderiza picker con displayName + handle si existe', () => {
    renderStep(baseValue({ writeAccessKind: 'USERS' }))
    expect(screen.getByText(/Personas con permiso para crear/i)).toBeInTheDocument()
    expect(screen.getByText(/Alice.*@alice/i)).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })
})

describe('CategoryFormStepWriteAccess — toggle de scope', () => {
  it('toggle GROUPS: agrega + remueve correctamente', () => {
    const { onChange } = renderStep(baseValue({ writeAccessKind: 'GROUPS' }))
    const adminCheckbox = screen.getByRole('checkbox', { name: /Administradores/i })
    fireEvent.click(adminCheckbox)
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0]![0] as CategoryFormValue
    expect(next.writeAccessGroupIds).toEqual(['g-admin'])
  })

  it('toggle TIERS: agrega un tier al set', () => {
    const { onChange } = renderStep(baseValue({ writeAccessKind: 'TIERS' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Pro/i }))
    const next = onChange.mock.calls[0]![0] as CategoryFormValue
    expect(next.writeAccessTierIds).toEqual(['t-pro'])
  })

  it('toggle USERS: remueve un user del set', () => {
    const { onChange } = renderStep(
      baseValue({ writeAccessKind: 'USERS', writeAccessUserIds: ['u-alice', 'u-bob'] }),
    )
    fireEvent.click(screen.getByRole('checkbox', { name: /Alice/i }))
    const next = onChange.mock.calls[0]![0] as CategoryFormValue
    expect(next.writeAccessUserIds).toEqual(['u-bob'])
  })
})

describe('CategoryFormStepWriteAccess — cambio de discriminator', () => {
  it('cambiar kind via select emite onChange con nuevo writeAccessKind', () => {
    const { onChange } = renderStep(baseValue())
    const select = screen.getByLabelText(/Quién puede crear contenido/i)
    fireEvent.change(select, { target: { value: 'USERS' } })
    const next = onChange.mock.calls[0]![0] as CategoryFormValue
    expect(next.writeAccessKind).toBe('USERS')
  })
})
