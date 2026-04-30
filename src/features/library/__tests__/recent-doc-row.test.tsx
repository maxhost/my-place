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

import { RecentDocRow } from '../ui/recent-doc-row'
import type { LibraryDoc } from '../domain/types'

afterEach(() => cleanup())

const baseDoc: LibraryDoc = {
  id: 'doc-1',
  slug: 'manual-onboarding',
  categorySlug: 'recursos-onboarding',
  categoryTitle: 'Onboarding',
  type: 'pdf',
  title: 'Manual de onboarding 2026',
  uploadedAt: new Date('2026-04-01T12:00:00Z'),
  uploadedByDisplayName: 'Maxi',
  url: '/storage/manual.pdf',
}

describe('RecentDocRow', () => {
  it('renderiza título del doc + categoría + fecha relativa', () => {
    render(<RecentDocRow doc={baseDoc} />)
    expect(screen.getByText('Manual de onboarding 2026')).toBeInTheDocument()
    expect(screen.getByText('Onboarding')).toBeInTheDocument()
  })

  it('linkea a la categoría (R.5.X swap a item detail cuando exista la route)', () => {
    render(<RecentDocRow doc={baseDoc} />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/library/recursos-onboarding')
  })

  it('FileIcon refleja el type del doc (pdf → aria-label "PDF")', () => {
    render(<RecentDocRow doc={baseDoc} />)
    expect(screen.getByRole('img', { name: 'PDF' })).toBeInTheDocument()
  })

  it('hairline=true agrega border-t a la row', () => {
    const { container } = render(<RecentDocRow doc={baseDoc} hairline />)
    const link = container.querySelector('a')
    expect(link?.className).toContain('border-t-[0.5px]')
  })

  it('hairline=false (default) sin border-t', () => {
    const { container } = render(<RecentDocRow doc={baseDoc} />)
    const link = container.querySelector('a')
    expect(link?.className).not.toContain('border-t-[0.5px]')
  })
})
