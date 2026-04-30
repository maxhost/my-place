import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const usePathnameMock = vi.fn()
const useSearchParamsMock = vi.fn()
const replaceMock = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
  useSearchParams: () => useSearchParamsMock(),
  useRouter: () => ({ replace: replaceMock }),
}))

import { ThreadFilterPills } from '../ui/thread-filter-pills'

beforeEach(() => {
  usePathnameMock.mockReset()
  useSearchParamsMock.mockReset()
  replaceMock.mockReset()
  usePathnameMock.mockReturnValue('/conversations')
})

afterEach(() => cleanup())

/**
 * Helper: simula `useSearchParams()` con un objeto URLSearchParams real.
 * Next devuelve un ReadonlyURLSearchParams compatible con la API estándar.
 */
function mockSearchParams(query: string): void {
  useSearchParamsMock.mockReturnValue(new URLSearchParams(query))
}

describe('ThreadFilterPills (URL state)', () => {
  describe('renderiza las 3 pills funcionales', () => {
    it('default sin filter en URL → "Todos" activo', () => {
      mockSearchParams('')
      render(<ThreadFilterPills />)
      const todos = screen.getByRole('tab', { name: 'Todos' })
      const sinResp = screen.getByRole('tab', { name: 'Sin respuesta' })
      const enLos = screen.getByRole('tab', { name: 'En los que participo' })
      expect(todos).toHaveAttribute('aria-selected', 'true')
      expect(sinResp).toHaveAttribute('aria-selected', 'false')
      expect(enLos).toHaveAttribute('aria-selected', 'false')
    })

    it('con `?filter=unanswered` → "Sin respuesta" activo', () => {
      mockSearchParams('filter=unanswered')
      render(<ThreadFilterPills />)
      expect(screen.getByRole('tab', { name: 'Sin respuesta' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.getByRole('tab', { name: 'Todos' })).toHaveAttribute('aria-selected', 'false')
    })

    it('con `?filter=participating` → "En los que participo" activo', () => {
      mockSearchParams('filter=participating')
      render(<ThreadFilterPills />)
      expect(screen.getByRole('tab', { name: 'En los que participo' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })

    it('filter inválido en URL → fallback "Todos" activo (defensive parse)', () => {
      mockSearchParams('filter=mine')
      render(<ThreadFilterPills />)
      expect(screen.getByRole('tab', { name: 'Todos' })).toHaveAttribute('aria-selected', 'true')
    })
  })

  describe('click cambia URL via router.replace (no push)', () => {
    it('click en "Sin respuesta" → router.replace con ?filter=unanswered', () => {
      mockSearchParams('')
      render(<ThreadFilterPills />)
      fireEvent.click(screen.getByRole('tab', { name: 'Sin respuesta' }))
      expect(replaceMock).toHaveBeenCalledWith('/conversations?filter=unanswered', {
        scroll: false,
      })
    })

    it('click en "Todos" desde otro filter → router.replace SIN query param (URL limpia)', () => {
      mockSearchParams('filter=participating')
      render(<ThreadFilterPills />)
      fireEvent.click(screen.getByRole('tab', { name: 'Todos' }))
      expect(replaceMock).toHaveBeenCalledWith('/conversations', { scroll: false })
    })

    it('click en pill activo → no dispara replace (idempotente)', () => {
      mockSearchParams('filter=unanswered')
      render(<ThreadFilterPills />)
      fireEvent.click(screen.getByRole('tab', { name: 'Sin respuesta' }))
      expect(replaceMock).not.toHaveBeenCalled()
    })

    it('preserva otros query params al cambiar de filter', () => {
      // Caso futuro: si search overlay (R.4) suma `?q=...`, el filter
      // no debería pisar otros params.
      mockSearchParams('q=algo')
      render(<ThreadFilterPills />)
      fireEvent.click(screen.getByRole('tab', { name: 'Sin respuesta' }))
      expect(replaceMock).toHaveBeenCalledWith(expect.stringMatching(/q=algo/), { scroll: false })
      expect(replaceMock).toHaveBeenCalledWith(expect.stringMatching(/filter=unanswered/), {
        scroll: false,
      })
    })
  })

  describe('a11y', () => {
    it('rol "tablist" en el nav', () => {
      mockSearchParams('')
      render(<ThreadFilterPills />)
      expect(screen.getByRole('tablist', { name: /Filtrar discusiones/ })).toBeInTheDocument()
    })

    it('cada pill tiene aria-selected reflejando estado activo (role tab)', () => {
      mockSearchParams('filter=unanswered')
      render(<ThreadFilterPills />)
      expect(screen.getByRole('tab', { name: 'Sin respuesta' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.getByRole('tab', { name: 'Todos' })).toHaveAttribute('aria-selected', 'false')
    })
  })
})
