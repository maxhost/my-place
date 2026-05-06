/**
 * Tests del `RichTextRenderer` (Server Component, visitor pattern AST → JSX).
 *
 * Como son Server Components async, los testeamos awaiteando la función
 * directo y montando el output como un árbol React-tree con `render` de
 * `@testing-library/react`. No instancia Lexical runtime — el renderer es
 * un visitor sobre el AST + lookup de mentions.
 */

import React from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { RichTextRenderer, type MentionResolvers } from '../ui/renderer'
import type {
  EmbedNode,
  HeadingNode,
  LexicalDocument,
  LinkNode,
  ListNode,
  MentionNode,
  ParagraphNode,
  TextNode,
} from '../domain/types'

function emptyDoc(): LexicalDocument {
  return {
    root: {
      type: 'root',
      version: 1,
      format: '',
      indent: 0,
      direction: null,
      children: [],
    },
  }
}

function docWith(
  ...children: ReadonlyArray<ParagraphNode | HeadingNode | ListNode | EmbedNode>
): LexicalDocument {
  return {
    root: {
      type: 'root',
      version: 1,
      format: '',
      indent: 0,
      direction: null,
      children: [...children],
    },
  }
}

function text(value: string, format = 0): TextNode {
  return { type: 'text', version: 1, text: value, format, detail: 0, mode: 'normal', style: '' }
}

function paragraph(...inlines: TextNode[] | LinkNode[] | MentionNode[]): ParagraphNode {
  return {
    type: 'paragraph',
    version: 1,
    format: '',
    indent: 0,
    direction: null,
    textFormat: 0,
    textStyle: '',
    children: [...inlines],
  }
}

const noopResolvers: MentionResolvers = {
  user: vi.fn(async () => null),
  event: vi.fn(async () => null),
  libraryItem: vi.fn(async () => null),
}

describe('RichTextRenderer', () => {
  afterEach(() => {
    cleanup()
  })

  it('renderiza un documento vacío como contenedor sin hijos', async () => {
    const node = await RichTextRenderer({ document: emptyDoc(), resolvers: noopResolvers })
    const { container } = render(<>{node}</>)
    const root = container.querySelector('.rich-text')
    expect(root).not.toBeNull()
    expect(root?.children.length).toBe(0)
  })

  it('renderiza null como contenedor sin hijos', async () => {
    const node = await RichTextRenderer({ document: null, resolvers: noopResolvers })
    const { container } = render(<>{node}</>)
    expect(container.querySelector('.rich-text')).not.toBeNull()
  })

  it('renderiza un párrafo con texto plano', async () => {
    const doc = docWith(paragraph(text('hola mundo')))
    const node = await RichTextRenderer({ document: doc, resolvers: noopResolvers })
    const { container } = render(<>{node}</>)
    const p = container.querySelector('p')
    expect(p?.textContent).toBe('hola mundo')
  })

  it('renderiza headings h1, h2, h3', async () => {
    const heading = (tag: 'h1' | 'h2' | 'h3', value: string): HeadingNode => ({
      type: 'heading',
      version: 1,
      tag,
      format: '',
      indent: 0,
      direction: null,
      children: [text(value)],
    })
    const doc = docWith(heading('h1', 'Uno'), heading('h2', 'Dos'), heading('h3', 'Tres'))
    const node = await RichTextRenderer({ document: doc, resolvers: noopResolvers })
    const { container } = render(<>{node}</>)
    expect(container.querySelector('h1')?.textContent).toBe('Uno')
    expect(container.querySelector('h2')?.textContent).toBe('Dos')
    expect(container.querySelector('h3')?.textContent).toBe('Tres')
  })

  it('renderiza listas ul/ol con sus items', async () => {
    const ul: ListNode = {
      type: 'list',
      version: 1,
      listType: 'bullet',
      start: 1,
      tag: 'ul',
      format: '',
      indent: 0,
      direction: null,
      children: [
        {
          type: 'listitem',
          version: 1,
          value: 1,
          format: '',
          indent: 0,
          direction: null,
          children: [text('uno')],
        },
        {
          type: 'listitem',
          version: 1,
          value: 2,
          format: '',
          indent: 0,
          direction: null,
          children: [text('dos')],
        },
      ],
    }
    const ol: ListNode = { ...ul, listType: 'number', tag: 'ol', start: 5 }
    const doc = docWith(ul, ol)
    const node = await RichTextRenderer({ document: doc, resolvers: noopResolvers })
    const { container } = render(<>{node}</>)
    expect(container.querySelectorAll('ul li').length).toBe(2)
    expect(container.querySelectorAll('ol li').length).toBe(2)
    expect(container.querySelector('ol')?.getAttribute('start')).toBe('5')
  })

  it('renderiza un link con href + texto', async () => {
    const link: LinkNode = {
      type: 'link',
      version: 1,
      url: 'https://example.com',
      rel: 'noopener',
      target: '_blank',
      title: null,
      format: '',
      indent: 0,
      direction: null,
      children: [text('clic')],
    }
    const doc = docWith(paragraph(link))
    const node = await RichTextRenderer({ document: doc, resolvers: noopResolvers })
    const { container } = render(<>{node}</>)
    const a = container.querySelector('a')
    expect(a?.getAttribute('href')).toBe('https://example.com')
    expect(a?.getAttribute('target')).toBe('_blank')
    expect(a?.getAttribute('rel')).toBe('noopener')
    expect(a?.textContent).toBe('clic')
  })

  it('renderiza una mention de usuario con resolver válido como link', async () => {
    const mention: MentionNode = {
      type: 'mention',
      version: 1,
      kind: 'user',
      targetId: 'usr_123',
      targetSlug: 'max',
      label: 'Max',
      placeId: 'place_1',
    }
    const doc = docWith(paragraph(mention))
    const resolvers: MentionResolvers = {
      user: vi.fn(async (id) => ({ label: 'Maximiliano', href: `/m/${id}` })),
      event: vi.fn(async () => null),
      libraryItem: vi.fn(async () => null),
    }
    const node = await RichTextRenderer({ document: doc, resolvers })
    const { container } = render(<>{node}</>)
    const a = container.querySelector('a.rich-text-mention')
    expect(a?.getAttribute('href')).toBe('/m/usr_123')
    expect(a?.textContent).toBe('@Maximiliano')
    expect(resolvers.user).toHaveBeenCalledWith('usr_123', 'place_1')
  })

  it('mention de usuario con resolver null preserva el snapshot label sin link', async () => {
    const mention: MentionNode = {
      type: 'mention',
      version: 1,
      kind: 'user',
      targetId: 'usr_gone',
      targetSlug: 'gone',
      label: 'Ex Miembro',
      placeId: 'place_1',
    }
    const doc = docWith(paragraph(mention))
    const node = await RichTextRenderer({ document: doc, resolvers: noopResolvers })
    const { container } = render(<>{node}</>)
    expect(container.querySelector('a.rich-text-mention')).toBeNull()
    expect(container.textContent).toContain('@Ex Miembro')
  })

  it('mention de event no resoluble pinta [EVENTO NO DISPONIBLE]', async () => {
    const mention: MentionNode = {
      type: 'mention',
      version: 1,
      kind: 'event',
      targetId: 'evt_gone',
      targetSlug: 'asado',
      label: 'Asado',
      placeId: 'place_1',
    }
    const doc = docWith(paragraph(mention))
    const node = await RichTextRenderer({ document: doc, resolvers: noopResolvers })
    const { container } = render(<>{node}</>)
    expect(container.textContent).toContain('[EVENTO NO DISPONIBLE]')
  })

  it('mention de library-item no resoluble pinta [RECURSO NO DISPONIBLE]', async () => {
    const mention: MentionNode = {
      type: 'mention',
      version: 1,
      kind: 'library-item',
      targetId: 'lib_gone',
      targetSlug: 'pan',
      label: 'Pan de campo',
      placeId: 'place_1',
    }
    const doc = docWith(paragraph(mention))
    const node = await RichTextRenderer({ document: doc, resolvers: noopResolvers })
    const { container } = render(<>{node}</>)
    expect(container.textContent).toContain('[RECURSO NO DISPONIBLE]')
  })

  it('mention de event resuelta renderiza un link al evento', async () => {
    const mention: MentionNode = {
      type: 'mention',
      version: 1,
      kind: 'event',
      targetId: 'evt_1',
      targetSlug: 'asado',
      label: 'Asado',
      placeId: 'place_1',
    }
    const doc = docWith(paragraph(mention))
    const resolvers: MentionResolvers = {
      user: vi.fn(async () => null),
      event: vi.fn(async (id, placeId) => {
        expect(placeId).toBe('place_1')
        return { label: 'Asado', href: `/events/${id}` }
      }),
      libraryItem: vi.fn(async () => null),
    }
    const node = await RichTextRenderer({ document: doc, resolvers })
    const { container } = render(<>{node}</>)
    const a = container.querySelector('a.rich-text-mention')
    expect(a?.getAttribute('href')).toBe('/events/evt_1')
  })

  it('aplica formato bold/italic/underline al texto via bitmask', async () => {
    const doc = docWith(paragraph(text('a', 1), text('b', 2), text('c', 8)))
    const node = await RichTextRenderer({ document: doc, resolvers: noopResolvers })
    const { container } = render(<>{node}</>)
    expect(container.querySelector('strong')?.textContent).toBe('a')
    expect(container.querySelector('em')?.textContent).toBe('b')
    expect(container.querySelector('u')?.textContent).toBe('c')
  })

  it('renderiza embed nodes como iframes con sandbox + lazy (F.4)', async () => {
    const yt: EmbedNode = { type: 'youtube', version: 1, videoId: 'abc' }
    const doc = docWith(yt)
    const node = await RichTextRenderer({ document: doc, resolvers: noopResolvers })
    const { container } = render(<>{node}</>)
    const wrap = container.querySelector('[data-embed-type="youtube"]')
    expect(wrap).not.toBeNull()
    const iframe = container.querySelector('iframe')
    expect(iframe?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/abc')
    expect(iframe?.getAttribute('sandbox')).toContain('allow-scripts')
    expect(iframe?.getAttribute('loading')).toBe('lazy')
  })

  it('renderiza embed Spotify con player oficial', async () => {
    const sp: EmbedNode = { type: 'spotify', version: 1, kind: 'track', externalId: 'abc123' }
    const doc = docWith(sp)
    const node = await RichTextRenderer({ document: doc, resolvers: noopResolvers })
    const { container } = render(<>{node}</>)
    const iframe = container.querySelector('iframe')
    expect(iframe?.getAttribute('src')).toBe('https://open.spotify.com/embed/track/abc123')
  })

  it('renderiza embed Apple con episode si está presente', async () => {
    const ap: EmbedNode = {
      type: 'apple-podcast',
      version: 1,
      region: 'us',
      showSlug: 'the-daily',
      showId: '1200361736',
      episodeId: '777',
    }
    const doc = docWith(ap)
    const node = await RichTextRenderer({ document: doc, resolvers: noopResolvers })
    const { container } = render(<>{node}</>)
    const iframe = container.querySelector('iframe')
    expect(iframe?.getAttribute('src')).toBe(
      'https://embed.podcasts.apple.com/us/podcast/the-daily/id1200361736?i=777',
    )
    expect(iframe?.getAttribute('height')).toBe('175')
  })

  it('renderiza embed Ivoox con player_ej', async () => {
    const iv: EmbedNode = { type: 'ivoox', version: 1, externalId: '42' }
    const doc = docWith(iv)
    const node = await RichTextRenderer({ document: doc, resolvers: noopResolvers })
    const { container } = render(<>{node}</>)
    const iframe = container.querySelector('iframe')
    expect(iframe?.getAttribute('src')).toBe('https://www.ivoox.com/player_ej_42_4_1.html')
  })

  it('respeta el className extra del consumer', async () => {
    const node = await RichTextRenderer({
      document: emptyDoc(),
      resolvers: noopResolvers,
      className: 'mt-3',
    })
    const { container } = render(<>{node}</>)
    const root = container.querySelector('.rich-text')
    expect(root?.className).toContain('mt-3')
  })
})
