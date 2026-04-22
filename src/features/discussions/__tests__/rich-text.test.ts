import { describe, expect, it } from 'vitest'
import {
  RICH_TEXT_MAX_BYTES,
  RICH_TEXT_MAX_LIST_DEPTH,
  assertRichTextSize,
  richTextByteSize,
  richTextExcerpt,
  richTextMaxListDepth,
} from '../domain/rich-text'
import { RichTextTooLarge } from '../domain/errors'
import type { RichTextDocument } from '../domain/types'

const simpleDoc = (text: string): RichTextDocument => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

describe('richTextByteSize', () => {
  it('cuenta bytes UTF-8, no chars', () => {
    const a = richTextByteSize(simpleDoc('a'))
    const ñ = richTextByteSize(simpleDoc('ñ'))
    expect(ñ).toBeGreaterThan(a) // ñ ocupa 2 bytes
  })
})

describe('assertRichTextSize', () => {
  it('no lanza con doc chico', () => {
    expect(() => assertRichTextSize(simpleDoc('hola'))).not.toThrow()
  })

  it('lanza RichTextTooLarge al exceder el cap', () => {
    const big = simpleDoc('x'.repeat(RICH_TEXT_MAX_BYTES + 10))
    expect(() => assertRichTextSize(big)).toThrow(RichTextTooLarge)
  })
})

describe('richTextMaxListDepth', () => {
  it('retorna 0 sin listas', () => {
    expect(richTextMaxListDepth(simpleDoc('sin listas'))).toBe(0)
  })

  it('retorna 1 con lista simple', () => {
    const doc: RichTextDocument = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }],
            },
          ],
        },
      ],
    }
    expect(richTextMaxListDepth(doc)).toBe(1)
  })

  it('mide profundidad con anidado triple', () => {
    const nested: RichTextDocument = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'orderedList',
                  content: [
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'bulletList',
                          content: [
                            {
                              type: 'listItem',
                              content: [
                                {
                                  type: 'paragraph',
                                  content: [{ type: 'text', text: 'profundo' }],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(richTextMaxListDepth(nested)).toBe(3)
  })

  it('blockquote no cuenta como lista', () => {
    const doc: RichTextDocument = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(richTextMaxListDepth(doc)).toBe(1)
  })

  it('constante del slice coincide con spec', () => {
    expect(RICH_TEXT_MAX_LIST_DEPTH).toBe(5)
  })
})

describe('richTextExcerpt', () => {
  it('concatena bloques con espacio y colapsa whitespace', () => {
    const doc: RichTextDocument = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hola  mundo' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '  segunda' }] },
      ],
    }
    expect(richTextExcerpt(doc, 100)).toBe('Hola mundo segunda')
  })

  it('resuelve mentions como @label', () => {
    const doc: RichTextDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hola ' },
            { type: 'mention', attrs: { userId: 'u-1', label: 'max' } },
          ],
        },
      ],
    }
    expect(richTextExcerpt(doc, 100)).toBe('Hola @max')
  })

  it('trunca al último espacio y agrega elipsis', () => {
    const doc = simpleDoc('uno dos tres cuatro cinco seis siete ocho nueve')
    const result = richTextExcerpt(doc, 20)
    expect(result.endsWith('…')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(21)
    expect(result).not.toContain('  ')
  })

  it('no trunca si el texto entra en el cap', () => {
    const doc = simpleDoc('corto')
    expect(richTextExcerpt(doc, 100)).toBe('corto')
  })

  it('lee contenido de codeBlock', () => {
    const doc: RichTextDocument = {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          content: [{ type: 'text', text: 'const x = 1' }],
        },
      ],
    }
    expect(richTextExcerpt(doc, 100)).toBe('const x = 1')
  })
})
