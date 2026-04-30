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

import { TypeFilterPills } from '../ui/type-filter-pills'

beforeEach(() => {
  usePathnameMock.mockReset()
  useSearchParamsMock.mockReset()
  replaceMock.mockReset()
  usePathnameMock.mockReturnValue('/library/onboarding')
})

afterEach(() => cleanup())

function mockSearchParams(query: string): void {
  useSearchParamsMock.mockReturnValue(new URLSearchParams(query))
}

describe('TypeFilterPills', () => {
  describe('available dinámicos', () => {
    it('available vacío → no renderiza nada (sin docs no hay tipos)', () => {
      mockSearchParams('')
      const { container } = render(<TypeFilterPills available={[]} />)
      expect(container).toBeEmptyDOMElement()
    })

    it('available [pdf, link] → muestra Todos + PDF + Links', () => {
      mockSearchParams('')
      render(<TypeFilterPills available={['pdf', 'link']} />)
      expect(screen.getByRole('tab', { name: 'Todos' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'PDF' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Links' })).toBeInTheDocument()
      // No image/doc/sheet (no estaban en available)
      expect(screen.queryByRole('tab', { name: 'Imágenes' })).not.toBeInTheDocument()
    })

    it('available con todos los tipos → muestra los 6 pills', () => {
      mockSearchParams('')
      render(<TypeFilterPills available={['pdf', 'link', 'image', 'doc', 'sheet']} />)
      expect(screen.getAllByRole('tab')).toHaveLength(6)
    })
  })

  describe('estado activo desde URL', () => {
    it('default (sin ?type=) → "Todos" activo', () => {
      mockSearchParams('')
      render(<TypeFilterPills available={['pdf']} />)
      expect(screen.getByRole('tab', { name: 'Todos' })).toHaveAttribute('aria-selected', 'true')
    })

    it('?type=pdf → "PDF" activo', () => {
      mockSearchParams('type=pdf')
      render(<TypeFilterPills available={['pdf', 'link']} />)
      expect(screen.getByRole('tab', { name: 'PDF' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tab', { name: 'Todos' })).toHaveAttribute('aria-selected', 'false')
    })

    it('valor inválido en URL → fallback "Todos" (defensive)', () => {
      mockSearchParams('type=mp3')
      render(<TypeFilterPills available={['pdf']} />)
      expect(screen.getByRole('tab', { name: 'Todos' })).toHaveAttribute('aria-selected', 'true')
    })
  })

  describe('click cambia URL via router.replace', () => {
    it('click en "PDF" desde "Todos" → router.replace ?type=pdf', () => {
      mockSearchParams('')
      render(<TypeFilterPills available={['pdf', 'link']} />)
      fireEvent.click(screen.getByRole('tab', { name: 'PDF' }))
      expect(replaceMock).toHaveBeenCalledWith('/library/onboarding?type=pdf', {
        scroll: false,
      })
    })

    it('click en "Todos" desde otro filter → URL limpia', () => {
      mockSearchParams('type=pdf')
      render(<TypeFilterPills available={['pdf']} />)
      fireEvent.click(screen.getByRole('tab', { name: 'Todos' }))
      expect(replaceMock).toHaveBeenCalledWith('/library/onboarding', { scroll: false })
    })

    it('click en pill activo → no dispara replace (idempotente)', () => {
      mockSearchParams('type=pdf')
      render(<TypeFilterPills available={['pdf']} />)
      fireEvent.click(screen.getByRole('tab', { name: 'PDF' }))
      expect(replaceMock).not.toHaveBeenCalled()
    })
  })
})
