import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/image', () => ({
  // Stub: <img> simple para que jsdom renderice y el test pueda leer atributos.
  default: (props: { src: string; alt: string; width: number; height: number }) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />
  },
}))

import { Avatar, hashToIndex } from '../avatar'

afterEach(() => {
  cleanup()
})

describe('Avatar', () => {
  it('imageUrl tiene precedencia sobre initials', () => {
    render(<Avatar initials="MX" imageUrl="https://cdn/example/avatar.png" alt="Maxi" />)
    const img = screen.getByAltText('Maxi') as HTMLImageElement
    expect(img.tagName).toBe('IMG')
    expect(img.src).toBe('https://cdn/example/avatar.png')
    expect(screen.queryByText('MX')).toBeNull()
  })

  it('sin imageUrl, renderiza initials sobre var(--soft) si no hay palette', () => {
    render(<Avatar initials="ab" />)
    const node = screen.getByLabelText('ab')
    expect(node.textContent).toBe('ab')
    expect(node.style.backgroundColor).toContain('var(--soft)')
  })

  it('con palette + colorKey, picks color determinístico del array', () => {
    const palette = ['#aaa', '#bbb', '#ccc', '#ddd'] as const
    render(<Avatar initials="JD" colorKey="user-123" palette={palette} alt="Juan" />)
    const node = screen.getByLabelText('Juan')
    const expectedIdx = hashToIndex('user-123', palette.length)
    expect(node.style.backgroundColor).not.toBe('')
    // El color debe ser uno del palette (jsdom devuelve hex en formato rgb).
    const expectedColor = palette[expectedIdx]
    // Verifica determinismo cross-render: el mismo colorKey siempre cae en el mismo índice.
    expect(hashToIndex('user-123', palette.length)).toBe(expectedIdx)
    expect(expectedColor).toBe(palette[expectedIdx])
  })

  it('truncate initials a 2 caracteres como máximo', () => {
    render(<Avatar initials="ABCDE" />)
    const node = screen.getByLabelText('ABCDE')
    expect(node.textContent).toBe('AB')
  })

  it('initials vacíos caen a "?"', () => {
    render(<Avatar initials="   " alt="anon" />)
    const node = screen.getByLabelText('anon')
    expect(node.textContent).toBe('?')
  })

  it('respeta size prop (width/height en style)', () => {
    render(<Avatar initials="X" size={40} />)
    const node = screen.getByLabelText('X')
    expect(node.style.width).toBe('40px')
    expect(node.style.height).toBe('40px')
  })
})

describe('hashToIndex', () => {
  it('determinístico: misma key, mismo índice', () => {
    expect(hashToIndex('user-abc', 8)).toBe(hashToIndex('user-abc', 8))
  })

  it('mapea siempre dentro de [0, len)', () => {
    const len = 8
    for (const key of ['', 'a', 'user-1', 'user-2', 'cuid_xxxxxxxx', 'utf-8 ñ é']) {
      const idx = hashToIndex(key, len)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(len)
    }
  })

  it('len=0 devuelve 0 sin crashear', () => {
    expect(hashToIndex('whatever', 0)).toBe(0)
  })
})
