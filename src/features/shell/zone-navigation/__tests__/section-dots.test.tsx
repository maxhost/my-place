import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const usePathnameMock = vi.fn()
const prefetchMock = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
  useRouter: () => ({ prefetch: prefetchMock }),
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

import { SectionDots } from '../ui/section-dots'

beforeEach(() => {
  prefetchMock.mockReset()
})

afterEach(() => {
  cleanup()
  usePathnameMock.mockReset()
})

describe('SectionDots', () => {
  it('renderiza 4 dots con aria-label de cada zona', () => {
    usePathnameMock.mockReturnValue('/')
    render(<SectionDots />)
    expect(screen.getByLabelText('Ir a Inicio')).toBeInTheDocument()
    expect(screen.getByLabelText('Ir a Conversaciones')).toBeInTheDocument()
    expect(screen.getByLabelText('Ir a Eventos')).toBeInTheDocument()
    expect(screen.getByLabelText('Ir a Biblioteca')).toBeInTheDocument()
  })

  it('"/" marca el dot de Inicio como aria-current="page"', () => {
    usePathnameMock.mockReturnValue('/')
    render(<SectionDots />)
    expect(screen.getByLabelText('Ir a Inicio')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('Ir a Conversaciones')).not.toHaveAttribute('aria-current')
  })

  it('"/conversations/[slug]" marca Conversaciones como current', () => {
    usePathnameMock.mockReturnValue('/conversations/algun-slug')
    render(<SectionDots />)
    expect(screen.getByLabelText('Ir a Conversaciones')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('Ir a Inicio')).not.toHaveAttribute('aria-current')
  })

  it('"/settings" no marca ningún dot como current', () => {
    usePathnameMock.mockReturnValue('/settings')
    render(<SectionDots />)
    expect(screen.queryByLabelText('Ir a Inicio')).not.toHaveAttribute('aria-current')
    expect(screen.queryByLabelText('Ir a Conversaciones')).not.toHaveAttribute('aria-current')
    expect(screen.queryByLabelText('Ir a Eventos')).not.toHaveAttribute('aria-current')
    expect(screen.queryByLabelText('Ir a Biblioteca')).not.toHaveAttribute('aria-current')
  })

  it('"/library" marca Biblioteca como current', () => {
    usePathnameMock.mockReturnValue('/library')
    render(<SectionDots />)
    expect(screen.getByLabelText('Ir a Biblioteca')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('Ir a Eventos')).not.toHaveAttribute('aria-current')
  })

  it('disabled=true agrega clase pointer-events-none + opacity-50', () => {
    usePathnameMock.mockReturnValue('/')
    const { container } = render(<SectionDots disabled />)
    const nav = container.querySelector('nav')
    expect(nav?.className).toContain('pointer-events-none')
    expect(nav?.className).toContain('opacity-50')
  })

  it('cada link apunta al path canónico de su zona', () => {
    usePathnameMock.mockReturnValue('/')
    render(<SectionDots />)
    expect(screen.getByLabelText('Ir a Inicio')).toHaveAttribute('href', '/')
    expect(screen.getByLabelText('Ir a Conversaciones')).toHaveAttribute('href', '/conversations')
    expect(screen.getByLabelText('Ir a Eventos')).toHaveAttribute('href', '/events')
    expect(screen.getByLabelText('Ir a Biblioteca')).toHaveAttribute('href', '/library')
  })

  describe('prefetch on hover/focus (R.2.5.3)', () => {
    it('hover sobre dot inactivo dispara router.prefetch del path destino', () => {
      usePathnameMock.mockReturnValue('/')
      render(<SectionDots />)
      fireEvent.mouseEnter(screen.getByLabelText('Ir a Conversaciones'))
      expect(prefetchMock).toHaveBeenCalledWith('/conversations')
    })

    it('focus sobre dot inactivo dispara prefetch (keyboard nav)', () => {
      usePathnameMock.mockReturnValue('/')
      render(<SectionDots />)
      fireEvent.focus(screen.getByLabelText('Ir a Eventos'))
      expect(prefetchMock).toHaveBeenCalledWith('/events')
    })

    it('hover sobre dot activo NO dispara prefetch (estamos ahí)', () => {
      usePathnameMock.mockReturnValue('/conversations')
      render(<SectionDots />)
      fireEvent.mouseEnter(screen.getByLabelText('Ir a Conversaciones'))
      expect(prefetchMock).not.toHaveBeenCalled()
    })

    it('disabled=true: hover NO dispara prefetch (place cerrado)', () => {
      usePathnameMock.mockReturnValue('/')
      render(<SectionDots disabled />)
      fireEvent.mouseEnter(screen.getByLabelText('Ir a Conversaciones'))
      expect(prefetchMock).not.toHaveBeenCalled()
    })
  })
})
