import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// `community-switcher.tsx` (mounted by AppShell) lee `clientEnv` via `placeUrl`.
// Mockeamos para evitar el parse eager del env real durante los tests.
vi.mock('@/shared/config/env', () => ({
  clientEnv: { NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000' },
}))

const usePathnameMock = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
  useRouter: () => ({ prefetch: vi.fn() }),
}))

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

import { AppShell } from '../ui/app-shell'

const places = [
  {
    id: 'p1',
    slug: 'the-company',
    name: 'The Company',
    description: null,
    billingMode: 'OWNER_PAYS' as const,
    archivedAt: null,
    createdAt: new Date('2026-01-01'),
    isOwner: false,
    isAdmin: false,
    joinedAt: new Date('2026-01-15'),
  },
]

afterEach(() => {
  cleanup()
  usePathnameMock.mockReset()
})

describe('AppShell', () => {
  it('renderiza TopBar + SectionDots + children', () => {
    usePathnameMock.mockReturnValue('/')
    render(
      <AppShell places={places} currentSlug="the-company" apexUrl="http://lvh.me:3000">
        <p>contenido de la zona</p>
      </AppShell>,
    )
    // Logo
    expect(screen.getByLabelText('Ir al inicio del producto')).toBeInTheDocument()
    // Switcher pill
    expect(screen.getByRole('button', { name: /the company/i })).toBeInTheDocument()
    // Search trigger (stub)
    expect(screen.getByLabelText('Buscar')).toBeInTheDocument()
    // Dots
    expect(screen.getByLabelText('Zonas del place')).toBeInTheDocument()
    // Children
    expect(screen.getByText('contenido de la zona')).toBeInTheDocument()
  })

  it('logo apunta al apexUrl (cross-subdomain via <a>)', () => {
    usePathnameMock.mockReturnValue('/')
    render(
      <AppShell places={places} currentSlug="the-company" apexUrl="http://lvh.me:3000">
        <p>x</p>
      </AppShell>,
    )
    expect(screen.getByLabelText('Ir al inicio del producto')).toHaveAttribute(
      'href',
      'http://lvh.me:3000',
    )
  })

  it('placeClosed=true deshabilita los dots (sin afectar el switcher)', () => {
    usePathnameMock.mockReturnValue('/')
    render(
      <AppShell places={places} currentSlug="the-company" apexUrl="http://lvh.me:3000" placeClosed>
        <p>x</p>
      </AppShell>,
    )
    const dotsNav = screen.getByLabelText('Zonas del place')
    expect(dotsNav.className).toContain('pointer-events-none')
    expect(dotsNav.className).toContain('opacity-50')
    // Switcher sigue accesible
    expect(screen.getByRole('button', { name: /the company/i })).toBeEnabled()
  })

  it('search trigger está siempre presente con aria-disabled (stub R.2)', () => {
    usePathnameMock.mockReturnValue('/conversations')
    render(
      <AppShell places={places} currentSlug="the-company" apexUrl="http://lvh.me:3000">
        <p>x</p>
      </AppShell>,
    )
    const search = screen.getByLabelText('Buscar')
    expect(search.getAttribute('aria-disabled')).toBe('true')
    expect(search.getAttribute('title')).toBe('Próximamente')
  })

  it('layout root default (wide=false) tiene max-w-[420px] mx-auto (mobile-first centrado)', () => {
    usePathnameMock.mockReturnValue('/')
    const { container } = render(
      <AppShell places={places} currentSlug="the-company" apexUrl="http://lvh.me:3000">
        <p>x</p>
      </AppShell>,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('max-w-[420px]')
    expect(root.className).toContain('mx-auto')
    expect(root.className).toContain('bg-bg')
  })

  it('layout root con wide=true: NO tiene max-w-[420px] (libera viewport para sidebar settings desktop)', () => {
    usePathnameMock.mockReturnValue('/settings/hours')
    const { container } = render(
      <AppShell places={places} currentSlug="the-company" apexUrl="http://lvh.me:3000" wide>
        <p>x</p>
      </AppShell>,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.className).not.toContain('max-w-[420px]')
    expect(root.className).toContain('w-full')
    // mx-auto + bg-bg siguen
    expect(root.className).toContain('mx-auto')
    expect(root.className).toContain('bg-bg')
  })
})
