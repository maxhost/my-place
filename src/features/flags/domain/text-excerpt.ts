import { FLAG_PREVIEW_MAX_CHARS } from './invariants'

/**
 * Extrae un excerpt de texto plano del body (TipTap JSON AST) de un Post o
 * Comment. Usado por la cola admin para scan-reading — por eso plain text, no
 * RichText rendering: la cola privilegia "ver qué están reportando rápido" y
 * evita acoplar el slice `flags` al renderer de `discussions`.
 *
 * Contrato:
 *  - Recibe `unknown` y es defensivo: no lanza para ningún input.
 *  - Camina paragraph/heading/list/blockquote/codeBlock/listItem recursivo.
 *  - Para nodos `text` usa `text`; para `mention` usa `attrs.label`.
 *  - Colapsa whitespace consecutivo a un solo espacio.
 *  - Trunca a `FLAG_PREVIEW_MAX_CHARS` con elipsis `…`.
 *
 * Nota: no consume `richTextExcerpt` de `discussions/domain/rich-text` para
 * preservar aislamiento entre slices (ver
 * `docs/decisions/2026-04-21-flags-subslice-split.md` §2).
 */
export function extractTextExcerpt(body: unknown): string {
  const parts: string[] = []
  walk(body, parts)
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim()
  if (joined.length <= FLAG_PREVIEW_MAX_CHARS) return joined
  return joined.slice(0, FLAG_PREVIEW_MAX_CHARS) + '…'
}

function walk(node: unknown, out: string[]): void {
  if (node === null || node === undefined) return
  if (typeof node !== 'object') return

  const n = node as Record<string, unknown>
  const type = typeof n.type === 'string' ? n.type : null

  if (type === 'text' && typeof n.text === 'string') {
    out.push(n.text)
    return
  }

  if (type === 'mention') {
    const attrs = n.attrs as Record<string, unknown> | undefined
    const label = attrs && typeof attrs.label === 'string' ? attrs.label : ''
    if (label) out.push(label)
    return
  }

  if (Array.isArray(n.content)) {
    for (const child of n.content) walk(child, out)
  }
}
