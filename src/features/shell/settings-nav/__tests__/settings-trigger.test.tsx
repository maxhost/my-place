import { describe, expect, it, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { SettingsTrigger } from '../ui/settings-trigger'

afterEach(() => {
  cleanup()
})

describe('SettingsTrigger', () => {
  it('renderiza un link a /settings con aria-label en español', () => {
    render(<SettingsTrigger />)
    const link = screen.getByRole('link', { name: 'Configuración del place' })
    expect(link).toHaveAttribute('href', '/settings')
  })

  it('matchea el sizing 36×36 del lenguaje del TopBar', () => {
    render(<SettingsTrigger />)
    const link = screen.getByRole('link', { name: 'Configuración del place' })
    // Tailwind classes h-9 / w-9 = 36px (9 × 4).
    expect(link.className).toContain('h-9')
    expect(link.className).toContain('w-9')
  })
})
