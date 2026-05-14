import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

// Sidebar ahora es Client Component que usa usePathname() para resolver
// active state. En jsdom sin Router context, hay que mockearlo — los tests
// siguen pasando `currentPath` explícito como override.
vi.mock('next/navigation', () => ({
  usePathname: () => null,
}))

import { Sidebar } from '../sidebar'
import type { SidebarSections } from '../sidebar.types'

afterEach(() => cleanup())

const SECTIONS: SidebarSections = [
  {
    id: 'place',
    label: 'Place',
    items: [
      { href: '/the-company/settings/hours', label: 'Horario' },
      { href: '/the-company/settings/access', label: 'Acceso' },
    ],
  },
  {
    id: 'comunidad',
    label: 'Comunidad',
    items: [
      { href: '/the-company/settings/members', label: 'Miembros' },
      { href: '/the-company/settings/groups', label: 'Grupos' },
    ],
  },
]

describe('<Sidebar> primitive', () => {
  describe('render básico', () => {
    it('renderiza un <nav> con el aria-label provisto', () => {
      render(
        <Sidebar
          items={SECTIONS}
          currentPath="/the-company/settings/hours"
          ariaLabel="Configuración del place"
        />,
      )
      const nav = screen.getByRole('navigation', { name: 'Configuración del place' })
      expect(nav).toBeInTheDocument()
    })

    it('renderiza todos los items con su label + href correcto', () => {
      render(<Sidebar items={SECTIONS} currentPath="/the-company/settings/hours" ariaLabel="Nav" />)
      const horario = screen.getByRole('link', { name: 'Horario' })
      expect(horario).toHaveAttribute('href', '/the-company/settings/hours')
      const miembros = screen.getByRole('link', { name: 'Miembros' })
      expect(miembros).toHaveAttribute('href', '/the-company/settings/members')
    })

    it('respeta el orden de groups y items definido en `items`', () => {
      render(<Sidebar items={SECTIONS} currentPath="/x" ariaLabel="Nav" />)
      const links = screen.getAllByRole('link').map((l) => l.textContent?.trim())
      expect(links).toEqual(['Horario', 'Acceso', 'Miembros', 'Grupos'])
    })
  })

  describe('grouping', () => {
    it('renderiza <h3> headers cuando group.label está', () => {
      render(<Sidebar items={SECTIONS} currentPath="/x" ariaLabel="Nav" />)
      expect(screen.getByRole('heading', { level: 3, name: 'Place' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 3, name: 'Comunidad' })).toBeInTheDocument()
    })

    it('NO renderiza <h3> cuando group.label es undefined', () => {
      const ungrouped: SidebarSections = [
        {
          id: 'g1',
          items: [
            { href: '/a', label: 'A' },
            { href: '/b', label: 'B' },
          ],
        },
      ]
      render(<Sidebar items={ungrouped} currentPath="/a" ariaLabel="Nav" />)
      expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
      // Pero los items sí están
      expect(screen.getByRole('link', { name: 'A' })).toBeInTheDocument()
    })
  })

  describe('active state', () => {
    it('item con href === currentPath tiene aria-current="page"', () => {
      render(
        <Sidebar items={SECTIONS} currentPath="/the-company/settings/members" ariaLabel="Nav" />,
      )
      const active = screen.getByRole('link', { name: 'Miembros' })
      expect(active).toHaveAttribute('aria-current', 'page')
    })

    it('items inactivos NO tienen aria-current', () => {
      render(
        <Sidebar items={SECTIONS} currentPath="/the-company/settings/members" ariaLabel="Nav" />,
      )
      const inactive = screen.getByRole('link', { name: 'Horario' })
      expect(inactive).not.toHaveAttribute('aria-current')
    })

    it('si ningún item matchea currentPath, ninguno está active', () => {
      render(<Sidebar items={SECTIONS} currentPath="/sin/match" ariaLabel="Nav" />)
      const allLinks = screen.getAllByRole('link')
      const withCurrent = allLinks.filter((l) => l.hasAttribute('aria-current'))
      expect(withCurrent).toHaveLength(0)
    })
  })

  describe('icons', () => {
    it('renderea el icon prop dentro del link cuando está', () => {
      const sectionsWithIcon: SidebarSections = [
        {
          id: 'g',
          items: [{ href: '/x', label: 'X', icon: <span data-testid="x-icon">★</span> }],
        },
      ]
      render(<Sidebar items={sectionsWithIcon} currentPath="/x" ariaLabel="Nav" />)
      const link = screen.getByRole('link', { name: /X/ })
      expect(within(link).getByTestId('x-icon')).toBeInTheDocument()
    })

    it('items sin icon renderean solo el label', () => {
      render(<Sidebar items={SECTIONS} currentPath="/x" ariaLabel="Nav" />)
      const horario = screen.getByRole('link', { name: 'Horario' })
      // Sin icon, el textContent debe ser exactamente el label
      expect(horario.textContent?.trim()).toBe('Horario')
    })
  })

  describe('accessibility', () => {
    it('cada link tiene clase focus-visible (keyboard nav visible)', () => {
      render(<Sidebar items={SECTIONS} currentPath="/x" ariaLabel="Nav" />)
      const horario = screen.getByRole('link', { name: 'Horario' })
      expect(horario.className).toMatch(/focus-visible:/)
    })

    it('los items son <a>/<Link> nativos (Tab navega + Enter activa por defecto del browser)', () => {
      render(<Sidebar items={SECTIONS} currentPath="/x" ariaLabel="Nav" />)
      const links = screen.getAllByRole('link')
      // Validar que todos tienen tagName 'A' (Next Link rendea anchor)
      for (const link of links) {
        expect(link.tagName).toBe('A')
      }
    })
  })

  describe('className override', () => {
    it('mergea className con defaults sin romperlos', () => {
      render(
        <Sidebar
          items={SECTIONS}
          currentPath="/x"
          ariaLabel="Nav"
          className="custom-sidebar-class"
        />,
      )
      const nav = screen.getByRole('navigation')
      expect(nav.className).toContain('custom-sidebar-class')
      // Y los defaults siguen presentes (alguna clase de width)
      expect(nav.className).toMatch(/w-/)
    })

    it('sin className override, usa solo los defaults', () => {
      render(<Sidebar items={SECTIONS} currentPath="/x" ariaLabel="Nav" />)
      const nav = screen.getByRole('navigation')
      expect(nav.className).toMatch(/w-/) // tiene width default
    })
  })

  describe('edge cases', () => {
    it('items vacíos en un group: no rompe, renderea el header pero sin items', () => {
      const empty: SidebarSections = [{ id: 'g', label: 'Vacío', items: [] }]
      render(<Sidebar items={empty} currentPath="/x" ariaLabel="Nav" />)
      expect(screen.getByRole('heading', { level: 3, name: 'Vacío' })).toBeInTheDocument()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })

    it('sections vacío: renderea el <nav> sin contenido', () => {
      render(<Sidebar items={[]} currentPath="/x" ariaLabel="Nav" />)
      expect(screen.getByRole('navigation', { name: 'Nav' })).toBeInTheDocument()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })
  })
})
