import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { EmptyLibrary } from '../ui/empty-library'
import { EmptyDocList } from '../ui/empty-doc-list'

afterEach(() => cleanup())

describe('EmptyLibrary (zona root)', () => {
  it('renderiza emoji + título sin CTA (decisión user 2026-04-30)', () => {
    render(<EmptyLibrary />)
    expect(screen.getByText('📭')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /Tu comunidad todavía no agregó recursos/ }),
    ).toBeInTheDocument()
    // No CTA — sin botón ni link
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('EmptyDocList (sub-page de categoría)', () => {
  it('default (categoría vacía sin filter) — emoji 🪶 + copy genérico', () => {
    render(<EmptyDocList />)
    expect(screen.getByText('🪶')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /Todavía no hay recursos en esta categoría/ }),
    ).toBeInTheDocument()
  })

  it('hasFilter=true — emoji 🔎 + copy "Sin resultados"', () => {
    render(<EmptyDocList hasFilter />)
    expect(screen.getByText('🔎')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Sin resultados/ })).toBeInTheDocument()
  })

  it('ningún caso muestra CTA (uploads diferidos)', () => {
    render(<EmptyDocList />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
