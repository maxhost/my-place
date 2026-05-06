import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// `places-list.tsx` importa `placeUrl` desde `@/shared/lib/app-url`, que a
// su vez importa `clientEnv` al top-level. Mockeamos para evitar el parse
// eager del env real durante los tests (Zod tiraría sin `NEXT_PUBLIC_*`).
vi.mock('@/shared/config/env', () => ({
  clientEnv: { NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000' },
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

import { PlacesList } from '@/features/places/ui/places-list'
import type { MyPlace } from '@/features/places/domain/types'

afterEach(() => {
  cleanup()
})

function makePlace(overrides: Partial<MyPlace> = {}): MyPlace {
  return {
    id: 'p1',
    slug: 'palermo',
    name: 'Palermo',
    description: null,
    billingMode: 'OWNER_PAYS',
    archivedAt: null,
    createdAt: new Date('2026-01-01'),
    isOwner: false,
    isAdmin: false,
    joinedAt: new Date('2026-01-15'),
    ...overrides,
  }
}

describe('PlacesList', () => {
  describe('empty state', () => {
    it('muestra CTA "Crear un place" cuando no hay places', () => {
      render(<PlacesList places={[]} />)
      expect(screen.getByText(/No pertenecés a ningún place/i)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Crear un place/i })).toHaveAttribute(
        'href',
        '/places/new',
      )
    })
  })

  describe('row del place', () => {
    it('renderiza link al place via subdomain', () => {
      const places = [makePlace({ name: 'Palermo', slug: 'palermo' })]
      render(<PlacesList places={places} />)
      const heading = screen.getByText('Palermo')
      const link = heading.closest('a')
      expect(link).toHaveAttribute('href', 'http://palermo.lvh.me:3000/')
    })

    it('muestra badge "owner" si isOwner', () => {
      const places = [makePlace({ isOwner: true })]
      render(<PlacesList places={places} />)
      expect(screen.getByText('owner')).toBeInTheDocument()
    })

    it('NO muestra badge "owner" si solo es member', () => {
      const places = [makePlace({ isOwner: false, isAdmin: false })]
      render(<PlacesList places={places} />)
      expect(screen.queryByText('owner')).not.toBeInTheDocument()
    })
  })

  describe('icono engranaje (R.S)', () => {
    it('admin (isAdmin=true) ve el link de configuración', () => {
      const places = [
        makePlace({ slug: 'palermo', name: 'Palermo', isAdmin: true, isOwner: false }),
      ]
      render(<PlacesList places={places} />)
      const link = screen.getByLabelText('Configuración de Palermo')
      expect(link).toHaveAttribute('href', 'http://palermo.lvh.me:3000/settings')
    })

    it('owner (isOwner=true) ve el link de configuración', () => {
      const places = [makePlace({ slug: 'palermo', name: 'Palermo', isAdmin: true, isOwner: true })]
      render(<PlacesList places={places} />)
      expect(screen.getByLabelText('Configuración de Palermo')).toBeInTheDocument()
    })

    it('member común NO ve el link de configuración', () => {
      const places = [
        makePlace({ slug: 'palermo', name: 'Palermo', isAdmin: false, isOwner: false }),
      ]
      render(<PlacesList places={places} />)
      expect(screen.queryByLabelText('Configuración de Palermo')).not.toBeInTheDocument()
    })

    it('mezcla: admin de uno + member de otro → solo el primero tiene engranaje', () => {
      const places = [
        makePlace({ id: 'p1', slug: 'palermo', name: 'Palermo', isAdmin: true }),
        makePlace({ id: 'p2', slug: 'belgrano', name: 'Belgrano', isAdmin: false }),
      ]
      render(<PlacesList places={places} />)
      expect(screen.getByLabelText('Configuración de Palermo')).toBeInTheDocument()
      expect(screen.queryByLabelText('Configuración de Belgrano')).not.toBeInTheDocument()
    })
  })
})
