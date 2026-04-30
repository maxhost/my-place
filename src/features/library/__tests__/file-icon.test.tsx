import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FileIcon } from '../ui/file-icon'
import type { DocType } from '../domain/types'

afterEach(() => cleanup())

describe('FileIcon', () => {
  const cases: Array<{ type: DocType; label: string }> = [
    { type: 'pdf', label: 'PDF' },
    { type: 'link', label: 'Link' },
    { type: 'image', label: 'Imagen' },
    { type: 'doc', label: 'Documento' },
    { type: 'sheet', label: 'Hoja de cálculo' },
  ]

  it.each(cases)('renderiza icono con aria-label "$label" para type "$type"', ({ type, label }) => {
    render(<FileIcon type={type} />)
    expect(screen.getByRole('img', { name: label })).toBeInTheDocument()
  })

  it('default size 36×36 — el span tiene width/height 36', () => {
    const { container } = render(<FileIcon type="pdf" />)
    const span = container.querySelector('span')
    expect(span?.style.width).toBe('36px')
    expect(span?.style.height).toBe('36px')
  })

  it('size personalizable via prop', () => {
    const { container } = render(<FileIcon type="pdf" size={48} />)
    const span = container.querySelector('span')
    expect(span?.style.width).toBe('48px')
    expect(span?.style.height).toBe('48px')
  })
})
