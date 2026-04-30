import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode
    href: string
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { CategoryCard } from '../ui/category-card'
import type { LibraryCategory } from '../domain/types'

afterEach(() => cleanup())

const baseCategory: LibraryCategory = {
  id: 'cat-1',
  slug: 'recursos-onboarding',
  emoji: '📘',
  title: 'Onboarding',
  docCount: 5,
}

describe('CategoryCard', () => {
  it('renderiza emoji + título', () => {
    render(<CategoryCard category={baseCategory} />)
    expect(screen.getByText('📘')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Onboarding' })).toBeInTheDocument()
  })

  it('count plural "5 documentos" cuando docCount > 1', () => {
    render(<CategoryCard category={baseCategory} />)
    expect(screen.getByText('5 documentos')).toBeInTheDocument()
  })

  it('count singular "1 documento" cuando docCount === 1', () => {
    render(<CategoryCard category={{ ...baseCategory, docCount: 1 }} />)
    expect(screen.getByText('1 documento')).toBeInTheDocument()
  })

  it('count "0 documentos" cuando docCount === 0', () => {
    render(<CategoryCard category={{ ...baseCategory, docCount: 0 }} />)
    expect(screen.getByText('0 documentos')).toBeInTheDocument()
  })

  it('link apunta a /library/<slug>', () => {
    render(<CategoryCard category={baseCategory} />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/library/recursos-onboarding')
  })
})
