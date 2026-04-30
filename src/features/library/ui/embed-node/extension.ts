'use client'

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { EmbedNodeView } from './node-view'

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
 * **Sintaxis defensiva**: cada attr declara `parseHTML` + `renderHTML`
 * explícitos. Sin esto, TipTap (v3 con duplicación de @tiptap/core en
 * el entorno dev) puede no resolver `addAttributes` correctamente y
 * persistir `attrs` como la function literal en lugar de su valor —
 * confirmado empíricamente con bodyRaw del server log.
 *
 * Validado por `richTextDocumentSchema` (extensión sumada en R.7.7 —
 * discussions/domain/rich-text-schemas.ts).
 *
 * Ver `docs/features/library/spec.md` § 12.
 */
export const EmbedNodeExtension = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  inline: false,

  addAttributes() {
    return {
      url: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-embed-url') ?? '',
        renderHTML: (attributes: { url?: string }) => ({
          'data-embed-url': attributes.url ?? '',
        }),
      },
      provider: {
        default: 'generic',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-embed-provider') ?? 'generic',
        renderHTML: (attributes: { provider?: string }) => ({
          'data-embed-provider': attributes.provider ?? 'generic',
        }),
      },
      title: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-embed-title') ?? '',
        renderHTML: (attributes: { title?: string }) => ({
          'data-embed-title': attributes.title ?? '',
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-embed]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-embed': 'true' }, HTMLAttributes)]
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
