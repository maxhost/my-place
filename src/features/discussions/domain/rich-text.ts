/**
 * Helpers de manipulación del TipTap JSON AST usado como body de Post/Comment.
 * Sin dependencias de runtime — operan sobre el shape declarado en `types.ts`.
 *
 * Ver `docs/features/discussions/spec.md` § 14 (rich text: límites, extensions).
 */

import { RichTextTooLarge } from './errors'
import type { RichTextBlockNode, RichTextDocument, RichTextInlineNode } from './types'

/** Body serializado máximo (UTF-8 bytes). Spec § 14. */
export const RICH_TEXT_MAX_BYTES = 20 * 1024

/** Profundidad máxima de listas anidadas. Spec § 14. */
export const RICH_TEXT_MAX_LIST_DEPTH = 5

/** Bytes UTF-8 del AST serializado. Fuente de verdad para el size cap. */
export function richTextByteSize(doc: unknown): number {
  return new TextEncoder().encode(JSON.stringify(doc)).length
}

export function assertRichTextSize(doc: unknown): void {
  const bytes = richTextByteSize(doc)
  if (bytes > RICH_TEXT_MAX_BYTES) {
    throw new RichTextTooLarge({ bytes, maxBytes: RICH_TEXT_MAX_BYTES })
  }
}

/**
 * Profundidad efectiva del nido de listas. Cada `bulletList`/`orderedList`
 * descendido suma 1; `blockquote` y `listItem` son transparentes.
 */
export function richTextMaxListDepth(doc: RichTextDocument): number {
  return walkListDepth(doc.content, 0)
}

function walkListDepth(nodes: RichTextBlockNode[], inListDepth: number): number {
  let max = inListDepth
  for (const node of nodes) {
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const next = inListDepth + 1
      for (const item of node.content) {
        const inner = walkListDepth(item.content, next)
        if (inner > max) max = inner
      }
    } else if (node.type === 'blockquote') {
      const inner = walkListDepth(node.content, inListDepth)
      if (inner > max) max = inner
    }
  }
  return max
}

/**
 * Extrae texto plano del AST para `bodyExcerpt` de citas.
 * - Un espacio entre bloques; colapsa whitespace.
 * - Ignora marks (bold, italic, code, link).
 * - Resuelve mentions como `@{label}`.
 * - Corta en el último espacio dentro de `maxChars` para no partir palabras
 *   (a menos que la palabra ocupe > 40% del cap, en cuyo caso corta duro).
 * - Agrega `…` si se truncó.
 */
export function richTextExcerpt(doc: RichTextDocument, maxChars: number): string {
  const chunks: string[] = []
  collectText(doc.content, chunks)
  const joined = chunks.join(' ').replace(/\s+/g, ' ').trim()
  if (joined.length <= maxChars) return joined
  const slice = joined.slice(0, maxChars)
  const lastSpace = slice.lastIndexOf(' ')
  const cut = lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice
  return `${cut}…`
}

function collectText(nodes: RichTextBlockNode[], out: string[]): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph':
      case 'heading':
        collectInline(node.content ?? [], out)
        break
      case 'blockquote':
        collectText(node.content, out)
        break
      case 'bulletList':
      case 'orderedList':
        for (const item of node.content) collectText(item.content, out)
        break
      case 'codeBlock':
        for (const t of node.content ?? []) out.push(t.text)
        break
    }
  }
}

function collectInline(nodes: RichTextInlineNode[], out: string[]): void {
  for (const node of nodes) {
    if (node.type === 'text') out.push(node.text)
    else if (node.type === 'mention') out.push(`@${node.attrs.label}`)
  }
}
