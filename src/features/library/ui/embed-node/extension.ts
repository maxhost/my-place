'use client'

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { EmbedNodeView } from './node-view'
import type { EmbedProvider } from '@/features/library/domain/embed-parser'

/**
 * Custom Node de TipTap para embeds intercalados en el body.
 *
 * Atomic block (no editable internamente) con tres atributos:
 *   - `url`: URL externa del recurso (https obligatorio).
 *   - `provider`: discriminador para render visual.
 *   - `title`: texto descriptivo opcional, indexable por search.
 *
 * El AST resulta:
 * ```
 * { type: 'embed', attrs: { url, provider, title } }
 * ```
 *
 * Validado por `richTextDocumentSchema` (extensión sumada en
 * 2026-04-30 — discussions/domain/rich-text-schemas.ts).
 *
 * Ver `docs/features/library/spec.md` § 12.
 */
export const EmbedNodeExtension = Node.create<{
  HTMLAttributes: Record<string, string>
}>({
  name: 'embed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { HTMLAttributes: {} }
  },

  addAttributes() {
    return {
      url: { default: '' },
      provider: { default: 'generic' as EmbedProvider },
      title: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-embed]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false
          return {
            url: el.getAttribute('data-embed-url') ?? '',
            provider: (el.getAttribute('data-embed-provider') ?? 'generic') as EmbedProvider,
            title: el.getAttribute('data-embed-title') ?? '',
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-embed': 'true',
        'data-embed-url': node.attrs.url as string,
        'data-embed-provider': node.attrs.provider as string,
        'data-embed-title': node.attrs.title as string,
      }),
    ]
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addNodeView(): any {
    // Cast amplio por incompatibilidad de tipos entre TipTap React y
    // ProseMirror cuando hay duplicación de prosemirror-model en
    // node_modules globales del entorno del dev — el shape efectivo
    // del NodeView es correcto, pero TS strict ve dos versiones de
    // `prosemirror-model` y no las une. Runtime correcto.
    return ReactNodeViewRenderer(EmbedNodeView as never)
  },
})
