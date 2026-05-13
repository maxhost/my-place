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
  placeId: 'place-1',
  slug: 'recursos-onboarding',
  emoji: '📘',
  title: 'Onboarding',
  position: 0,
  contributionPolicy: 'DESIGNATED',
  kind: 'GENERAL',
  readAccessKind: 'PUBLIC',
  writeAccessKind: 'OWNER_ONLY',
  groupScopeIds: [],
  archivedAt: null,
  createdAt: new Date('2026-04-01'),
  updatedAt: new Date('2026-04-01'),
  docCount: 5,
}

describe('CategoryCard', () => {
  it('renderiza emoji + título', () => {
    render(<CategoryCard category={baseCategory} />)
    expect(screen.getByText('📘')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Onboarding' })).toBeInTheDocument()
  })

  it('count plural "5 recursos" (plural) cuando docCount > 1', () => {
    render(<CategoryCard category={baseCategory} />)
    expect(screen.getByText('5 recursos')).toBeInTheDocument()
  })

  it('count singular "1 recurso" cuando docCount === 1', () => {
    render(<CategoryCard category={{ ...baseCategory, docCount: 1 }} />)
    expect(screen.getByText('1 recurso')).toBeInTheDocument()
  })

  it('count plural "0 recursos" cuando docCount === 0', () => {
    render(<CategoryCard category={{ ...baseCategory, docCount: 0 }} />)
    expect(screen.getByText('0 recursos')).toBeInTheDocument()
  })

  it('link apunta a /library/<slug>', () => {
    render(<CategoryCard category={baseCategory} />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/library/recursos-onboarding')
  })
})
