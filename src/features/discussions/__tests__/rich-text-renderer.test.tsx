import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { RichTextRenderer } from '../ui/rich-text-renderer'
import type { RichTextDocument } from '../domain/types'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

function doc(content: RichTextDocument['content']): RichTextDocument {
  return { type: 'doc', content }
}

describe('RichTextRenderer', () => {
  it('paragraph simple con texto plano', () => {
    const { container } = render(
      <RichTextRenderer
        doc={doc([{ type: 'paragraph', content: [{ type: 'text', text: 'hola' }] }])}
      />,
    )
    const p = container.querySelector('p')
    expect(p?.textContent).toBe('hola')
  })

  it('marks: bold, italic, code wrappen el texto', () => {
    const { container } = render(
      <RichTextRenderer
        doc={doc([
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
              { type: 'text', text: 'i', marks: [{ type: 'italic' }] },
              { type: 'text', text: 'c', marks: [{ type: 'code' }] },
            ],
          },
        ])}
      />,
    )
    expect(container.querySelector('strong')?.textContent).toBe('b')
    expect(container.querySelector('em')?.textContent).toBe('i')
    expect(container.querySelector('code')?.textContent).toBe('c')
  })

  it('heading nivel 2 y 3 emiten h2/h3', () => {
    const { container } = render(
      <RichTextRenderer
        doc={doc([
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'dos' }],
          },
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'tres' }],
          },
        ])}
      />,
    )
    expect(container.querySelector('h2')?.textContent).toBe('dos')
    expect(container.querySelector('h3')?.textContent).toBe('tres')
  })

  it('bulletList + orderedList + listItem anidados', () => {
    const { container } = render(
      <RichTextRenderer
        doc={doc([
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
              },
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
                            type: 'paragraph',
                            content: [{ type: 'text', text: 'b' }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ])}
      />,
    )
    expect(container.querySelectorAll('ul').length).toBe(1)
    expect(container.querySelectorAll('ol').length).toBe(1)
    expect(container.querySelectorAll('li').length).toBe(3)
  })

  it('blockquote wrappea bloques anidados', () => {
    const { container } = render(
      <RichTextRenderer
        doc={doc([
          {
            type: 'blockquote',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'citado' }] }],
          },
        ])}
      />,
    )
    const bq = container.querySelector('blockquote')
    expect(bq).toBeTruthy()
    expect(bq?.querySelector('p')?.textContent).toBe('citado')
  })

  it('codeBlock emite <pre><code> con el texto concatenado', () => {
    const { container } = render(
      <RichTextRenderer
        doc={doc([
          {
            type: 'codeBlock',
            content: [
              { type: 'text', text: 'line1\n' },
              { type: 'text', text: 'line2' },
            ],
          },
        ])}
      />,
    )
    const code = container.querySelector('pre code')
    expect(code?.textContent).toBe('line1\nline2')
  })

  it('link mark emite <a> con rel y target', () => {
    const { container } = render(
      <RichTextRenderer
        doc={doc([
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'click',
                marks: [
                  {
                    type: 'link',
                    attrs: {
                      href: 'https://example.com',
                      target: '_blank',
                      rel: 'noopener noreferrer',
                    },
                  },
                ],
              },
            ],
          },
        ])}
      />,
    )
    const a = container.querySelector('a[href="https://example.com"]')
    expect(a).toBeTruthy()
    expect(a?.getAttribute('target')).toBe('_blank')
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('mention con placeSlug emite Link al perfil contextual', () => {
    const { container } = render(
      <RichTextRenderer
        placeSlug="the-place"
        doc={doc([
          {
            type: 'paragraph',
            content: [
              {
                type: 'mention',
                attrs: { userId: 'user-42', label: 'max' },
              },
            ],
          },
        ])}
      />,
    )
    const a = container.querySelector('a[href="/m/user-42"]')
    expect(a).toBeTruthy()
    expect(a?.textContent).toBe('@max')
  })

  it('mention sin placeSlug cae a texto plano', () => {
    const { container } = render(
      <RichTextRenderer
        doc={doc([
          {
            type: 'paragraph',
            content: [
              {
                type: 'mention',
                attrs: { userId: 'user-42', label: 'max' },
              },
            ],
          },
        ])}
      />,
    )
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('@max')
  })

  it('marks anidados componen correctamente (bold+italic)', () => {
    const { container } = render(
      <RichTextRenderer
        doc={doc([
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'bi',
                marks: [{ type: 'bold' }, { type: 'italic' }],
              },
            ],
          },
        ])}
      />,
    )
    const strong = container.querySelector('strong')
    const em = strong?.querySelector('em')
    expect(em?.textContent).toBe('bi')
  })
})
