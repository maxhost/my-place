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
 * Tests del step "Escritura" del wizard de categoría.
 *
 * Cubre:
 *  - 4 opciones del enum WriteAccessKind aparecen en el select.
 *  - Sub-picker condicional según el kind. Picker = `<SearchableMultiSelect>`
 *    (combobox). Opciones aparecen en el dropdown al hacer focus en el
 *    input.
 *  - Toggle vía click en option del dropdown.
 *  - Remove vía click en X del chip.
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

  it('OWNER_ONLY: NO renderiza combobox de scope', () => {
    renderStep(baseValue({ writeAccessKind: 'OWNER_ONLY' }))
    expect(screen.queryByRole('combobox', { name: /Grupos con permiso/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /Tiers con permiso/i })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('combobox', { name: /Personas con permiso/i }),
    ).not.toBeInTheDocument()
  })

  it('GROUPS: renderiza combobox de grupos; focus muestra opciones (preset arriba)', () => {
    renderStep(baseValue({ writeAccessKind: 'GROUPS' }))
    const input = screen.getByRole('combobox', { name: /Grupos con permiso para crear/i })
    expect(input).toBeInTheDocument()
    fireEvent.focus(input)
    expect(screen.getByRole('option', { name: /Administradores/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Mods/i })).toBeInTheDocument()
  })

  it('TIERS: renderiza combobox de tiers; focus muestra opciones', () => {
    renderStep(baseValue({ writeAccessKind: 'TIERS' }))
    const input = screen.getByRole('combobox', { name: /Tiers con permiso para crear/i })
    fireEvent.focus(input)
    expect(screen.getByRole('option', { name: /Pro/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Basic/i })).toBeInTheDocument()
  })

  it('USERS: renderiza combobox de personas con displayName + handle visible en opciones', () => {
    renderStep(baseValue({ writeAccessKind: 'USERS' }))
    const input = screen.getByRole('combobox', { name: /Personas con permiso para crear/i })
    fireEvent.focus(input)
    const aliceOption = screen.getByRole('option', { name: /Alice/i })
    expect(aliceOption).toBeInTheDocument()
    expect(aliceOption.textContent).toMatch(/@alice/)
    expect(screen.getByRole('option', { name: /Bob/i })).toBeInTheDocument()
  })
})

describe('CategoryFormStepWriteAccess — toggle via dropdown click', () => {
  it('GROUPS: click en opción del dropdown agrega al set', () => {
    const { onChange } = renderStep(baseValue({ writeAccessKind: 'GROUPS' }))
    const input = screen.getByRole('combobox', { name: /Grupos con permiso para crear/i })
    fireEvent.focus(input)
    fireEvent.click(screen.getByRole('option', { name: /Administradores/i }))
    const next = onChange.mock.calls[0]![0] as CategoryFormValue
    expect(next.writeAccessGroupIds).toEqual(['g-admin'])
  })

  it('TIERS: click en opción agrega el tier al set', () => {
    const { onChange } = renderStep(baseValue({ writeAccessKind: 'TIERS' }))
    const input = screen.getByRole('combobox', { name: /Tiers con permiso para crear/i })
    fireEvent.focus(input)
    fireEvent.click(screen.getByRole('option', { name: /Pro/i }))
    const next = onChange.mock.calls[0]![0] as CategoryFormValue
    expect(next.writeAccessTierIds).toEqual(['t-pro'])
  })

  it('USERS: click en opción ya seleccionada la remueve del set', () => {
    const { onChange } = renderStep(
      baseValue({ writeAccessKind: 'USERS', writeAccessUserIds: ['u-alice', 'u-bob'] }),
    )
    const input = screen.getByRole('combobox', { name: /Personas con permiso para crear/i })
    fireEvent.focus(input)
    fireEvent.click(screen.getByRole('option', { name: /Alice/i }))
    const next = onChange.mock.calls[0]![0] as CategoryFormValue
    expect(next.writeAccessUserIds).toEqual(['u-bob'])
  })
})

describe('CategoryFormStepWriteAccess — remove via chip X', () => {
  it('USERS: click en X del chip remueve al user', () => {
    const { onChange } = renderStep(
      baseValue({ writeAccessKind: 'USERS', writeAccessUserIds: ['u-alice'] }),
    )
    fireEvent.click(screen.getByRole('button', { name: /Quitar Alice/i }))
    const next = onChange.mock.calls[0]![0] as CategoryFormValue
    expect(next.writeAccessUserIds).toEqual([])
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
