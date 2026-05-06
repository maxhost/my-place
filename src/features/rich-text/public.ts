/**
 * Superficie pública del slice `rich-text`.
 *
 * Sólo exports client-safe + tipos. Server-only (queries, resolvers de mention)
 * viven en `public.server.ts`. Ver gotcha sobre split público en CLAUDE.md.
 */

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

// ---------------------------------------------------------------
// UI client-safe (Client Components con `'use client'` o tipos puros)
// ---------------------------------------------------------------

export { RichTextRendererClient } from './ui/renderer-client'

export { BaseComposer } from './ui/base-composer'
export type { BaseComposerProps, ComposerSurface } from './ui/base-composer'

export { CommentComposer } from './ui/comment-composer'
export type { CommentComposerProps } from './ui/comment-composer'

export {
  MentionNode as MentionLexicalNode,
  $createMentionNode,
  $isMentionNode,
} from './ui/mentions/mention-node'
export type { MentionKind, MentionPayload } from './ui/mentions/mention-node'

export type {
  ComposerMentionResolvers,
  MentionEventResult,
  MentionLibraryCategoryResult,
  MentionLibraryItemResult,
  MentionResolversForEditor,
  MentionUserResult,
} from './ui/mentions/mention-plugin'

// F.4: surface composers
export { PostComposer } from './ui/post-composer'
export type { PostComposerProps } from './ui/post-composer'

export { EventComposer } from './ui/event-composer'
export type { EventComposerProps } from './ui/event-composer'

export { LibraryItemComposer } from './ui/library-item-composer'
export type { LibraryItemComposerProps } from './ui/library-item-composer'

export type { EnabledEmbeds } from './ui/base-composer'
