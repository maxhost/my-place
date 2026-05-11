import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SettingsShell } from '../ui/settings-shell'
import { SettingsMobileHub } from '../ui/settings-mobile-hub'

afterEach(() => cleanup())

describe('<SettingsShell> composer', () => {
  it('renderiza el sidebar con aria-label "Configuración del place"', () => {
    render(
      <SettingsShell currentPath="/settings/hours" isOwner={false}>
        <p>Page content</p>
      </SettingsShell>,
    )
    expect(screen.getByRole('navigation', { name: 'Configuración del place' })).toBeInTheDocument()
  })

  it('children se renderean en el content area', () => {
    render(
      <SettingsShell currentPath="/x/settings/hours" isOwner={false}>
        <p data-testid="content">Custom content</p>
      </SettingsShell>,
    )
    expect(screen.getByTestId('content')).toBeInTheDocument()
  })

  it('sidebar oculto en mobile via CSS (hidden md:flex)', () => {
    render(
      <SettingsShell currentPath="/x/settings/hours" isOwner={false}>
        <p>x</p>
      </SettingsShell>,
    )
    const nav = screen.getByRole('navigation')
    expect(nav.className).toMatch(/hidden/)
    expect(nav.className).toMatch(/md:flex/)
  })

  it('owner ve más items que admin (members, groups, tiers, editor)', () => {
    render(
      <SettingsShell currentPath="/x/settings/hours" isOwner={false}>
        <p>x</p>
      </SettingsShell>,
    )
    const adminLinks = screen.getAllByRole('link').length

    cleanup()
    render(
      <SettingsShell currentPath="/x/settings/hours" isOwner={true}>
        <p>x</p>
      </SettingsShell>,
    )
    const ownerLinks = screen.getAllByRole('link').length
    expect(ownerLinks).toBeGreaterThan(adminLinks)
  })

  it('item activo (currentPath match) tiene aria-current="page"', () => {
    render(
      <SettingsShell currentPath="/settings/hours" isOwner={true}>
        <p>x</p>
      </SettingsShell>,
    )
    const horario = screen.getByRole('link', { name: /Horarios/i })
    expect(horario).toHaveAttribute('aria-current', 'page')
  })

  it('content area tiene max-width responsive (max-w-screen-md)', () => {
    const { container } = render(
      <SettingsShell currentPath="/x/settings/hours" isOwner={false}>
        <p data-testid="content">x</p>
      </SettingsShell>,
    )
    const contentWrapper = container.querySelector('div.flex-1')
    expect(contentWrapper?.className).toMatch(/max-w-screen-md/)
  })
})

describe('<SettingsMobileHub>', () => {
  it('renderiza el header con texto placeholder de futuro dashboard', () => {
    render(<SettingsMobileHub isOwner={false} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Configuración' })).toBeInTheDocument()
    expect(screen.getByText(/Pronto vivirá acá el dashboard/i)).toBeInTheDocument()
  })

  it('renderiza secciones agrupadas con sus items', () => {
    render(<SettingsMobileHub isOwner={true} />)
    // Group headers
    expect(screen.getByRole('heading', { level: 2, name: 'Place' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Comunidad' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Contenido' })).toBeInTheDocument()
    // Items
    expect(screen.getByRole('link', { name: /Horarios/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Miembros/i })).toBeInTheDocument()
  })

  it('admin (no owner) NO ve sección Comunidad (todos sus items son owner-only)', () => {
    render(<SettingsMobileHub isOwner={false} />)
    expect(screen.queryByRole('heading', { level: 2, name: 'Comunidad' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Miembros/i })).not.toBeInTheDocument()
  })

  it('cada card linkea al href correcto del item', () => {
    render(<SettingsMobileHub isOwner={true} />)
    const horario = screen.getByRole('link', { name: /Horarios/i })
    expect(horario).toHaveAttribute('href', '/settings/hours')
  })

  it('cards tienen min-height para touch target ≥56px', () => {
    render(<SettingsMobileHub isOwner={false} />)
    const links = screen.getAllByRole('link')
    for (const link of links) {
      expect(link.className).toMatch(/min-h-/)
    }
  })
})
