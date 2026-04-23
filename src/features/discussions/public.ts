/**
 * API pública del slice `discussions`. Único punto de entrada para otras features.
 * Ver `docs/architecture.md` § boundaries y `docs/features/discussions/spec.md`.
 *
 * No exporta internals: queries, helpers de rich-text privados, renderers SSR.
 * Las demás features (members, events, hours) consumen únicamente lo listado acá.
 */

export type { ActorContext } from './domain/invariants'

export type {
  AuthorSnapshot,
  Comment,
  CommentId,
  ContentTargetKind,
  PlaceOpening,
  PlaceOpeningId,
  PlaceOpeningSource,
  Post,
  PostId,
  PostListView,
  PostRead,
  PostReadId,
  PostState,
  QuoteTargetState,
  QuoteSnapshot,
  QuoteSourceComment,
  Reaction,
  ReactionEmoji,
  ReactionId,
  RichTextBlockNode,
  RichTextDocument,
  RichTextInlineNode,
  RichTextMark,
  RichTextMention,
  RichTextText,
} from './domain/types'

export {
  DORMANT_THRESHOLD_MS,
  DWELL_THRESHOLD_MS,
  EDIT_WINDOW_MS,
  POST_TITLE_MAX_LENGTH,
  POST_TITLE_MIN_LENGTH,
  QUOTE_EXCERPT_MAX_CHARS,
  REACTION_EMOJI_DISPLAY,
  assertCommentAlive,
  assertEditWindowOpen,
  assertPostOpenForActivity,
  assertQuotedCommentAlive,
  assertQuotedCommentBelongsToPost,
  buildAuthorSnapshot,
  buildQuoteSnapshot,
  canAdminHide,
  canDeleteContent,
  canEditAuthorContent,
  canEditPost,
  derivePostState,
  editWindowOpen,
  isDormant,
} from './domain/invariants'

export {
  RICH_TEXT_MAX_BYTES,
  RICH_TEXT_MAX_LIST_DEPTH,
  assertRichTextSize,
  richTextByteSize,
  richTextExcerpt,
  richTextMaxListDepth,
} from './domain/rich-text'

export {
  CommentDeletedError,
  EditWindowExpired,
  InvalidMention,
  InvalidQuoteTarget,
  PostHiddenError,
  RichTextTooLarge,
} from './domain/errors'

export {
  COMMENT_PAGE_SIZE,
  POST_PAGE_SIZE,
  findCommentById,
  findPostById,
  findPostBySlug,
  listCommentsByPost,
  listPostsByPlace,
  listReadersByPost,
  type CommentView,
  type PostReader,
} from './server/queries'

export {
  aggregateReactions,
  reactionMapKey,
  type AggregatedReaction,
  type ReactionAggregationMap,
} from './server/reactions-aggregation'

export { resolveViewerForPlace, type DiscussionViewer } from './server/actor'

export { findOrCreateCurrentOpening } from './server/place-opening'

export {
  createPostAction,
  deletePostAction,
  editPostAction,
  hidePostAction,
  openPostEditSession,
  unhidePostAction,
} from './server/actions/posts'

export {
  createCommentAction,
  deleteCommentAction,
  editCommentAction,
  openCommentEditSession,
} from './server/actions/comments'

export {
  loadMoreCommentsAction,
  loadMorePostsAction,
  type SerializedCursor,
} from './server/actions/load-more'

export { reactAction, unreactAction } from './server/actions/reactions'
export { markPostReadAction } from './server/actions/reads'

export { RESERVED_POST_SLUGS, generatePostSlug } from './domain/slug'

export { CommentThread } from './ui/comment-thread'
export { DwellTracker } from './ui/dwell-tracker'
export { PostComposer } from './ui/post-composer'
export { PostDetail } from './ui/post-detail'
export { PostList } from './ui/post-list'
export { PostReadersBlock } from './ui/post-readers-block'
export { PostUnreadDot } from './ui/post-unread-dot'
export { ThreadPresence } from './ui/thread-presence'

export {
  createCommentInputSchema,
  createPostInputSchema,
  deleteCommentInputSchema,
  deletePostInputSchema,
  editCommentInputSchema,
  editPostInputSchema,
  hidePostInputSchema,
  markPostReadInputSchema,
  reactInputSchema,
  richTextDocumentSchema,
  unhidePostInputSchema,
  unreactInputSchema,
  type CreateCommentInput,
  type CreatePostInput,
  type DeleteCommentInput,
  type DeletePostInput,
  type EditCommentInput,
  type EditPostInput,
  type HidePostInput,
  type MarkPostReadInput,
  type ReactInput,
  type RichTextDocumentParsed,
  type UnhidePostInput,
  type UnreactInput,
} from './schemas'
