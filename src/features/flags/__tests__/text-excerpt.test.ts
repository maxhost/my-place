import { describe, expect, it } from 'vitest'
import { extractTextExcerpt } from '../domain/text-excerpt'

describe('extractTextExcerpt', () => {
  it('devuelve string vacía para body null/undefined/no-doc', () => {
    expect(extractTextExcerpt(null)).toBe('')
    expect(extractTextExcerpt(undefined)).toBe('')
    expect(extractTextExcerpt({})).toBe('')
    expect(extractTextExcerpt({ type: 'doc' })).toBe('')
    expect(extractTextExcerpt('string directa')).toBe('')
  })

  it('extrae texto plano de un paragraph simple', () => {
    const body = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hola mundo' }],
        },
      ],
    }
    expect(extractTextExcerpt(body)).toBe('Hola mundo')
  })

  it('concatena texto de múltiples paragraphs con espacios', () => {
    const body = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Primero.' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Segundo.' }],
        },
      ],
    }
    expect(extractTextExcerpt(body)).toBe('Primero. Segundo.')
  })

  it('camina marks anidados preservando el texto', () => {
    const body = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hola ' },
            { type: 'text', text: 'mundo', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' y ' },
            {
              type: 'text',
              text: 'enlace',
              marks: [{ type: 'link', attrs: { href: 'https://x.com' } }],
            },
          ],
        },
      ],
    }
    expect(extractTextExcerpt(body)).toBe('Hola mundo y enlace')
  })

  it('camina listas anidadas', () => {
    const body = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'uno' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'dos' }],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(extractTextExcerpt(body)).toContain('uno')
    expect(extractTextExcerpt(body)).toContain('dos')
  })

  it('trunca a 160 chars y agrega elipsis', () => {
    const longText = 'a'.repeat(200)
    const body = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: longText }] }],
    }
    const result = extractTextExcerpt(body)
    expect(result.length).toBeLessThanOrEqual(161)
    expect(result.endsWith('…')).toBe(true)
  })

  it('no trunca si el texto cabe en el límite', () => {
    const body = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'corto' }] }],
    }
    expect(extractTextExcerpt(body)).toBe('corto')
  })

  it('no lanza con AST malformado', () => {
    expect(() => extractTextExcerpt({ type: 'doc', content: 'not-array' })).not.toThrow()
    expect(() => extractTextExcerpt({ type: 'doc', content: [null, undefined, 42] })).not.toThrow()
    expect(() =>
      extractTextExcerpt({
        type: 'doc',
        content: [{ type: 'unknown-node' }],
      }),
    ).not.toThrow()
  })

  it('colapsa whitespace duplicado para quedar compacto', () => {
    const body = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '  Hola   ' },
            { type: 'text', text: '   mundo  ' },
          ],
        },
      ],
    }
    expect(extractTextExcerpt(body)).toBe('Hola mundo')
  })

  it('extrae texto de mentions usando el label', () => {
    const body = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hola ' },
            { type: 'mention', attrs: { userId: 'u-1', label: '@maxi' } },
          ],
        },
      ],
    }
    expect(extractTextExcerpt(body)).toBe('hola @maxi')
  })
})
