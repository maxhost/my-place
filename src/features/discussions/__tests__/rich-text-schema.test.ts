import { describe, expect, it } from 'vitest'
import { richTextDocumentSchema } from '../schemas'
import { RICH_TEXT_MAX_BYTES } from '../domain/rich-text'

const doc = (content: unknown[]): unknown => ({ type: 'doc', content })

describe('richTextDocumentSchema — happy path', () => {
  it('acepta paragraph con text y marks bold+italic', () => {
    const input = doc([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'hola', marks: [{ type: 'bold' }, { type: 'italic' }] }],
      },
    ])
    expect(richTextDocumentSchema.safeParse(input).success).toBe(true)
  })

  it('acepta heading h2 y h3', () => {
    const input = doc([
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H2' }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'H3' }] },
    ])
    expect(richTextDocumentSchema.safeParse(input).success).toBe(true)
  })

  it('acepta bulletList anidada, blockquote, codeBlock y mention', () => {
    const input = doc([
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }],
          },
        ],
      },
      {
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cita' }] }],
      },
      { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1' }] },
      {
        type: 'paragraph',
        content: [{ type: 'mention', attrs: { userId: 'u1', label: 'max' } }],
      },
    ])
    expect(richTextDocumentSchema.safeParse(input).success).toBe(true)
  })

  it('acepta link con protocolo https y attrs requeridos', () => {
    const input = doc([
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'enlace',
            marks: [
              {
                type: 'link',
                attrs: {
                  href: 'https://place.app',
                  target: '_blank',
                  rel: 'noopener noreferrer',
                },
              },
            ],
          },
        ],
      },
    ])
    expect(richTextDocumentSchema.safeParse(input).success).toBe(true)
  })

  it('acepta link con protocolo mailto', () => {
    const input = doc([
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'email',
            marks: [
              {
                type: 'link',
                attrs: {
                  href: 'mailto:hola@place.app',
                  target: '_blank',
                  rel: 'noopener noreferrer',
                },
              },
            ],
          },
        ],
      },
    ])
    expect(richTextDocumentSchema.safeParse(input).success).toBe(true)
  })
})

describe('richTextDocumentSchema — rechazos por construcción', () => {
  it('rechaza nodo desconocido', () => {
    const input = doc([{ type: 'image', attrs: { src: 'x.png' } }])
    expect(richTextDocumentSchema.safeParse(input).success).toBe(false)
  })

  it('rechaza heading level 1', () => {
    const input = doc([
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'x' }] },
    ])
    expect(richTextDocumentSchema.safeParse(input).success).toBe(false)
  })

  it('rechaza link con protocolo http', () => {
    const input = doc([
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'enlace',
            marks: [
              {
                type: 'link',
                attrs: {
                  href: 'http://place.app',
                  target: '_blank',
                  rel: 'noopener noreferrer',
                },
              },
            ],
          },
        ],
      },
    ])
    expect(richTextDocumentSchema.safeParse(input).success).toBe(false)
  })

  it('rechaza link con javascript:', () => {
    const input = doc([
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'xss',
            marks: [
              {
                type: 'link',
                attrs: {
                  href: 'javascript:alert(1)',
                  target: '_blank',
                  rel: 'noopener noreferrer',
                },
              },
            ],
          },
        ],
      },
    ])
    expect(richTextDocumentSchema.safeParse(input).success).toBe(false)
  })

  it('rechaza link sin rel noopener', () => {
    const input = doc([
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'enlace',
            marks: [
              {
                type: 'link',
                attrs: { href: 'https://x.com', target: '_blank', rel: 'opener' },
              },
            ],
          },
        ],
      },
    ])
    expect(richTextDocumentSchema.safeParse(input).success).toBe(false)
  })

  it('rechaza mark desconocido', () => {
    const input = doc([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'x', marks: [{ type: 'strikethrough' }] }],
      },
    ])
    expect(richTextDocumentSchema.safeParse(input).success).toBe(false)
  })

  it('rechaza campos extra en attrs (strict)', () => {
    const input = doc([
      {
        type: 'heading',
        attrs: { level: 2, color: 'red' },
        content: [{ type: 'text', text: 'x' }],
      },
    ])
    expect(richTextDocumentSchema.safeParse(input).success).toBe(false)
  })

  it('rechaza body que excede el size cap', () => {
    const bigText = 'x'.repeat(RICH_TEXT_MAX_BYTES + 100)
    const input = doc([{ type: 'paragraph', content: [{ type: 'text', text: bigText }] }])
    const result = richTextDocumentSchema.safeParse(input)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) => (i as { params?: { kind?: string } }).params?.kind === 'size',
        ),
      ).toBe(true)
    }
  })

  it('rechaza listas anidadas con profundidad > 5', () => {
    // Construimos 6 niveles de bulletList anidados.
    let node: unknown = {
      type: 'paragraph',
      content: [{ type: 'text', text: 'x' }],
    }
    for (let i = 0; i < 6; i++) {
      node = {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [node] }],
      }
    }
    const input = doc([node])
    const result = richTextDocumentSchema.safeParse(input)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) => (i as { params?: { kind?: string } }).params?.kind === 'depth',
        ),
      ).toBe(true)
    }
  })

  it('rechaza doc vacío', () => {
    expect(richTextDocumentSchema.safeParse({ type: 'doc', content: [] }).success).toBe(false)
  })

  it('rechaza text vacío', () => {
    const input = doc([{ type: 'paragraph', content: [{ type: 'text', text: '' }] }])
    expect(richTextDocumentSchema.safeParse(input).success).toBe(false)
  })
})
