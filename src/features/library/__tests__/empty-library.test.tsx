import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { EmptyLibrary } from '../ui/empty-library'
import { EmptyItemList } from '../ui/empty-item-list'

afterEach(() => cleanup())

describe('EmptyLibrary (zona root)', () => {
  it('default (member común) — emoji + copy sin CTA', () => {
    render(<EmptyLibrary />)
    expect(screen.getByText('📭')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /Tu comunidad todavía no agregó recursos/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('canManageCategories=true — suma link a /settings/library', () => {
    render(<EmptyLibrary canManageCategories />)
    const link = screen.getByRole('link', { name: /Crear primera categoría/ })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/settings/library')
  })
})

describe('EmptyItemList (sub-page de categoría)', () => {
  it('default (sin filter, sin permiso) — copy calmo sin CTA', () => {
    render(<EmptyItemList />)
    expect(screen.getByText('🪶')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /Todavía no hay recursos en esta categoría/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('hasFilter=true — emoji 🔎 + copy "Sin resultados"', () => {
    render(<EmptyItemList hasFilter />)
    expect(screen.getByText('🔎')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Sin resultados/ })).toBeInTheDocument()
  })

  it('canCreate=true + categorySlug — suma CTA "Crear el primero"', () => {
    render(<EmptyItemList canCreate categorySlug="recetas" />)
    const link = screen.getByRole('link', { name: /Crear el primero/ })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/library/recetas/new')
  })

  it('canCreate=true sin categorySlug → no CTA (defensivo)', () => {
    render(<EmptyItemList canCreate />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
