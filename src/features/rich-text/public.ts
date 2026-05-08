/**
 * Superficie pública del slice `rich-text` — barrel **lite** (sin Composers).
 *
 * Sólo exports client-safe livianos: tipos del documento Lexical,
 * schemas Zod, helpers puros (`richTextExcerpt`, `assertRichTextSize`),
 * `RichTextRendererClient` (renderer cliente sin Lexical core), y
 * mention nodes para serialización.
 *
 * Los **Composers** (BaseComposer + CommentComposer + PostComposer +
 * EventComposer + LibraryItemComposer) viven en
 * `@/features/rich-text/composers/public` — sub-slice public dedicado.
 * Importarlos arrastra Lexical entero (~126 kB gzip), por eso se
 * separó: pages que sólo renderizan rich-text (listas, detalles)
 * importan de este barrel y NO traen Lexical al bundle eager. Pages
 * de creación/edición importan del sub-slice composers (eager) o
 * via `next/dynamic` (lazy on-focus, patrón Reddit).
 *
 * Server-only (renderer SSR async, resolvers de mention con queries
 * Prisma) viven en `public.server.ts`. Ver gotcha sobre split público
 * en CLAUDE.md.
 *
 * Cada sub-slice tiene su propio cap 1500 LOC; el split honesto reemplaza
 * la excepción provisoria que existió post-migración TipTap → Lexical.
 *
 * Ver `docs/decisions/2026-05-08-sub-slice-cross-public.md`.
 */

// ---------------------------------------------------------------
// Sub-slices client-safe del slice `rich-text`
// ---------------------------------------------------------------

// Mentions: sólo **types** acá. `MentionNode` (DecoratorNode Lexical),
// `$createMentionNode`, `$isMentionNode` y `MentionPlugin` viven en
// `@/features/rich-text/mentions/public` — son value-side y arrastran
// Lexical core. Re-exportarlos desde acá rompía el split del barrel
// (cualquier import de helper puro como `richTextExcerpt` traía Lexical
// por side-effect del re-export). Ver ADR
// `2026-05-08-sub-slice-cross-public.md`.
export type {
  ComposerMentionResolvers,
  MentionEventResult,
  MentionKind,
  MentionLibraryCategoryResult,
  MentionLibraryItemResult,
  MentionPayload,
  MentionResolversForEditor,
  MentionUserResult,
} from './mentions/public'

// Renderer client-safe (el SSR vive en `public.server.ts`). NO arrastra
// Composers — sólo el árbol de render para el AST Lexical ya parseado.
export { RichTextRendererClient } from './renderer/public'

// ---------------------------------------------------------------
// Domain primitives (siguen viviendo en `domain/`, comunes a todos
// los sub-slices del rich-text — no son un sub-slice por sí mismos).
// ---------------------------------------------------------------

export type {
  ApplePodcastEmbed,
  BlockNode,
  CommentDocument,
  ElementDirection,
  ElementFormat,
  EmbedNode,
  EventDocument,
  HeadingNode,
  InlineNode,
  IvooxEmbed,
  LexicalDocument,
  LibraryItemDocument,
  LineBreakNode,
  LinkNode,
  ListItemNode,
  ListNode,
  MentionNode,
  ParagraphNode,
  PostDocument,
  QuoteSnapshot,
  RootNode,
  SpotifyEmbed,
  TextNode,
  YoutubeEmbed,
} from './domain/types'

export {
  applePodcastEmbedSchema,
  commentDocumentSchema,
  embedNodeSchema,
  eventDocumentSchema,
  headingNodeSchema,
  ivooxEmbedSchema,
  libraryItemDocumentSchema,
  lineBreakNodeSchema,
  linkNodeSchema,
  listItemNodeSchema,
  listNodeSchema,
  mentionNodeSchema,
  paragraphNodeSchema,
  postDocumentSchema,
  richTextDocumentSchema,
  rootNodeSchema,
  spotifyEmbedSchema,
  textNodeSchema,
  youtubeEmbedSchema,
} from './domain/schemas'

export {
  RICH_TEXT_MAX_BYTES,
  RICH_TEXT_MAX_LIST_DEPTH,
  assertRichTextSize,
  richTextByteSize,
  richTextMaxListDepth,
} from './domain/size'

export type { AssertRichTextSizeOpts } from './domain/size'

export { RichTextTooDeepError, RichTextTooLargeError } from './domain/errors'

export { richTextExcerpt } from './domain/excerpt'

export { buildQuoteSnapshot } from './domain/snapshot'
export type { BuildQuoteSnapshotInput } from './domain/snapshot'
