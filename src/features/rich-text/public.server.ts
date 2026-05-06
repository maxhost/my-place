import 'server-only'

/**
 * Superficie server-only del slice `rich-text`.
 *
 * Server Components que importan `import 'server-only'` directo o transitivo
 * (ej. el renderer SSR). El split client/server espeja el patrón de
 * `flags/` y `discussions/` (ADR `2026-04-21-flags-subslice-split.md`).
 */

export { RichTextRenderer } from './ui/renderer'
export type { MentionResolvers } from './ui/renderer'
