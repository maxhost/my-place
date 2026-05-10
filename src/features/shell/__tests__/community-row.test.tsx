import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// `community-row.tsx` importa `placeUrl` desde `@/shared/lib/app-url`,
// que lee `clientEnv.NEXT_PUBLIC_APP_DOMAIN`. Mockeamos para evitar el
// parse eager del env real (Zod tiraría sin `NEXT_PUBLIC_*`).
vi.mock('@/shared/config/env', () => ({
  clientEnv: { NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000' },
}))

import { CommunityRow } from '../ui/community-row'

afterEach(() => {
  cleanup()
})

const basePlace = {
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
}

describe('CommunityRow', () => {
  it('renderiza nombre + initial del avatar', () => {
    const onSelect = vi.fn()
    render(<CommunityRow place={basePlace} isCurrent={false} onSelect={onSelect} />)
    expect(screen.getByText('The Company')).toBeInTheDocument()
    expect(screen.getByText('T')).toBeInTheDocument() // initial
  })

  it('rol "Miembro" cuando isAdmin=false e isOwner=false', () => {
    render(<CommunityRow place={basePlace} isCurrent={false} onSelect={vi.fn()} />)
    expect(screen.getByText('Miembro')).toBeInTheDocument()
  })

  it('rol "Admin" cuando isAdmin=true', () => {
    render(
      <CommunityRow place={{ ...basePlace, isAdmin: true }} isCurrent={false} onSelect={vi.fn()} />,
    )
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('rol "Owner" cuando isOwner=true (override isAdmin)', () => {
    render(
      <CommunityRow
        place={{ ...basePlace, isAdmin: true, isOwner: true }}
        isCurrent={false}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText('Owner')).toBeInTheDocument()
  })

  it('isCurrent=true agrega aria-current="true" + bg-accent-soft + check', () => {
    const { container } = render(<CommunityRow place={basePlace} isCurrent onSelect={vi.fn()} />)
    // Post-2026-05-09: el row es un `div role=menuitem` (no `button`)
    // porque el icon Gear lo necesita como `<a>` separado.
    const item = container.querySelector('[role="menuitem"]') as HTMLElement
    expect(item.getAttribute('aria-current')).toBe('true')
    expect(item.className).toContain('bg-accent-soft')
    // El check es un span aria-hidden con icon Check inside
    expect(container.querySelectorAll('svg')).toHaveLength(1)
  })

  it('isCurrent=false: sin aria-current, sin check icon', () => {
    const { container } = render(
      <CommunityRow place={basePlace} isCurrent={false} onSelect={vi.fn()} />,
    )
    const item = container.querySelector('[role="menuitem"]') as HTMLElement
    expect(item.getAttribute('aria-current')).toBeNull()
    // basePlace no es admin/owner → no hay gear → cero svg
    expect(container.querySelectorAll('svg')).toHaveLength(0)
  })

  it('click en el row dispara onSelect con el slug', () => {
    const onSelect = vi.fn()
    const { container } = render(
      <CommunityRow place={basePlace} isCurrent={false} onSelect={onSelect} />,
    )
    // El click target es el button interno (toda la fila salvo el gear).
    const innerButton = container.querySelector('[role="menuitem"] > button') as HTMLElement
    fireEvent.click(innerButton)
    expect(onSelect).toHaveBeenCalledWith('the-company')
  })

  it('admin/owner: muestra Gear icon que linkea a /<slug>/settings', () => {
    const { container } = render(
      <CommunityRow place={{ ...basePlace, isAdmin: true }} isCurrent={false} onSelect={vi.fn()} />,
    )
    const gear = container.querySelector('a[aria-label*="Configuración"]') as HTMLAnchorElement
    expect(gear).not.toBeNull()
    expect(gear.getAttribute('href')).toContain('/settings')
    expect(gear.getAttribute('href')).toContain('the-company.lvh.me')
  })

  it('no-admin no-owner: NO muestra Gear icon', () => {
    const { container } = render(
      <CommunityRow place={basePlace} isCurrent={false} onSelect={vi.fn()} />,
    )
    expect(container.querySelector('a[aria-label*="Configuración"]')).toBeNull()
  })

  it('Gear click NO dispara onSelect (stopPropagation defensivo)', () => {
    const onSelect = vi.fn()
    const { container } = render(
      <CommunityRow
        place={{ ...basePlace, isOwner: true }}
        isCurrent={false}
        onSelect={onSelect}
      />,
    )
    const gear = container.querySelector('a[aria-label*="Configuración"]') as HTMLAnchorElement
    // jsdom no navega `<a href>` real, pero el handler stopPropagation se
    // ejecuta. El point del test: onSelect NO se invoca aunque el evento
    // suba al div padre.
    fireEvent.click(gear)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('initial fallback "?" cuando nombre vacío', () => {
    render(
      <CommunityRow place={{ ...basePlace, name: '   ' }} isCurrent={false} onSelect={vi.fn()} />,
    )
    expect(screen.getByText('?')).toBeInTheDocument()
  })
})
