import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const routerBack = vi.fn()
const routerPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: routerBack, push: routerPush }),
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

import { BackButton, BackLink } from '../back-button'

beforeEach(() => {
  routerBack.mockReset()
  routerPush.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('BackButton', () => {
  it('renderiza con aria-label "Volver" por default', () => {
    render(<BackButton />)
    expect(screen.getByLabelText('Volver')).toBeInTheDocument()
  })

  it('aria-label custom via prop', () => {
    render(<BackButton label="Atrás" />)
    expect(screen.getByLabelText('Atrás')).toBeInTheDocument()
  })

  it('click dispara router.back() cuando hay history (length > 1)', () => {
    Object.defineProperty(window, 'history', {
      configurable: true,
      value: { length: 5 },
    })
    render(<BackButton />)
    fireEvent.click(screen.getByLabelText('Volver'))
    expect(routerBack).toHaveBeenCalledOnce()
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('click dispara router.push(fallbackHref) cuando history.length <= 1 (deep link)', () => {
    Object.defineProperty(window, 'history', {
      configurable: true,
      value: { length: 1 },
    })
    render(<BackButton fallbackHref="/conversations" />)
    fireEvent.click(screen.getByLabelText('Volver'))
    expect(routerPush).toHaveBeenCalledWith('/conversations')
    expect(routerBack).not.toHaveBeenCalled()
  })

  it('fallbackHref default es "/" si no se pasa', () => {
    Object.defineProperty(window, 'history', {
      configurable: true,
      value: { length: 1 },
    })
    render(<BackButton />)
    fireEvent.click(screen.getByLabelText('Volver'))
    expect(routerPush).toHaveBeenCalledWith('/')
  })

  it('href determinista ignora history y dispara router.push(href) aunque haya history', () => {
    Object.defineProperty(window, 'history', {
      configurable: true,
      value: { length: 5 },
    })
    render(<BackButton href="/events" fallbackHref="/conversations" />)
    fireEvent.click(screen.getByLabelText('Volver'))
    expect(routerPush).toHaveBeenCalledWith('/events')
    expect(routerBack).not.toHaveBeenCalled()
  })

  it('href determinista funciona también sin history disponible', () => {
    Object.defineProperty(window, 'history', {
      configurable: true,
      value: { length: 1 },
    })
    render(<BackButton href="/conversations" />)
    fireEvent.click(screen.getByLabelText('Volver'))
    expect(routerPush).toHaveBeenCalledWith('/conversations')
    expect(routerBack).not.toHaveBeenCalled()
  })

  it('icono ChevronLeft con aria-hidden', () => {
    render(<BackButton />)
    const button = screen.getByLabelText('Volver')
    const svg = button.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('BackLink', () => {
  it('renderiza <a> con href y aria-label', () => {
    render(<BackLink href="/conversations" label="Volver al listado" />)
    const link = screen.getByLabelText('Volver al listado') as HTMLAnchorElement
    expect(link.tagName).toBe('A')
    expect(link.href).toContain('/conversations')
  })

  it('aria-label default "Volver" si no se pasa', () => {
    render(<BackLink href="/" />)
    expect(screen.getByLabelText('Volver')).toBeInTheDocument()
  })
})
