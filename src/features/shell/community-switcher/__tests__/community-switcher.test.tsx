import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

// `community-switcher.tsx` importa `placeUrl` desde `@/shared/lib/app-url`,
// que lee `clientEnv.NEXT_PUBLIC_APP_DOMAIN`. Mockeamos para evitar el parse
// eager del env real (Zod tiraría sin `NEXT_PUBLIC_*`).
vi.mock('@/shared/config/env', () => ({
  clientEnv: { NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000' },
}))

// `community-switcher.tsx` importa la server action `logout` que arrastra
// `supabase/server` (lee env server-side completo). En tests sólo nos importa
// que la sección logout aparezca con form-action — la invocación real la
// cubren los tests del action mismo (si los hay).
vi.mock('@/app/logout/actions', () => ({
  logout: vi.fn(),
}))

import { CommunitySwitcher } from '../ui/community-switcher'

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
  {
    id: 'p2',
    slug: 'palermo-cowork',
    name: 'Palermo Cowork',
    description: null,
    billingMode: 'OWNER_PAYS' as const,
    archivedAt: null,
    createdAt: new Date('2026-01-02'),
    isOwner: true,
    isAdmin: true,
    joinedAt: new Date('2026-01-20'),
  },
]

let assignSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  assignSpy = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      protocol: 'http:',
      assign: assignSpy,
    },
  })
})

afterEach(() => {
  cleanup()
})

describe('CommunitySwitcher', () => {
  it('cerrado por default: dropdown no visible', () => {
    render(<CommunitySwitcher places={places} currentSlug="the-company" />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('click en pill abre el dropdown con header + lista', () => {
    render(<CommunitySwitcher places={places} currentSlug="the-company" />)
    fireEvent.click(screen.getByRole('button', { name: /the company/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByText('Tus comunidades')).toBeInTheDocument()
  })

  it('aria-expanded refleja el estado', () => {
    render(<CommunitySwitcher places={places} currentSlug="the-company" />)
    const trigger = screen.getByRole('button', { name: /the company/i })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('selección de current place es no-op (cierra sin navegar)', () => {
    render(<CommunitySwitcher places={places} currentSlug="the-company" />)
    fireEvent.click(screen.getByRole('button', { name: /the company/i }))
    // Post-2026-05-09: el menuitem ahora es un `div` (contiene un button +
    // opcionalmente un `<a>` Gear). Click target es el button interno.
    const currentItem = screen.getByRole('menuitem', { name: /the company/i })
    fireEvent.click(within(currentItem).getByRole('button'))
    expect(assignSpy).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('selección de otro place dispara cross-subdomain navigation', () => {
    render(<CommunitySwitcher places={places} currentSlug="the-company" />)
    fireEvent.click(screen.getByRole('button', { name: /the company/i }))
    const otherItem = screen.getByRole('menuitem', { name: /palermo cowork/i })
    fireEvent.click(within(otherItem).getByRole('button'))
    expect(assignSpy).toHaveBeenCalledWith('http://palermo-cowork.lvh.me:3000/')
  })

  it('ESC cierra el dropdown', () => {
    render(<CommunitySwitcher places={places} currentSlug="the-company" />)
    fireEvent.click(screen.getByRole('button', { name: /the company/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('click en backdrop cierra el dropdown', () => {
    render(<CommunitySwitcher places={places} currentSlug="the-company" />)
    fireEvent.click(screen.getByRole('button', { name: /the company/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('lista vacía muestra empty state', () => {
    render(<CommunitySwitcher places={[]} currentSlug="the-company" />)
    // currentSlug se renderiza tal cual cuando current no está en la lista.
    fireEvent.click(screen.getByRole('button', { name: /the-company/i }))
    expect(screen.getByText('No tenés comunidades activas.')).toBeInTheDocument()
  })

  it('current place se renderiza en el pill aunque no esté en la lista (defensa)', () => {
    render(<CommunitySwitcher places={[]} currentSlug="orphan-slug" />)
    expect(screen.getByRole('button', { name: /orphan-slug/i })).toBeInTheDocument()
  })
})
