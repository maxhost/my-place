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
  PostLibraryItemLink,
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
  canAdminHide,
  canDeleteContent,
  canEditAuthorContent,
  canEditPost,
  derivePostState,
  editWindowOpen,
  isDormant,
} from './domain/invariants'

// F.3: re-exports temporales de los composers/renderers Lexical para
// minimizar churn en consumers que importaban del barrel `discussions`. F.6
// audita si siguen siendo necesarios o se inlinean los imports al
// `rich-text/public(.server)?` directo.
export { CommentComposer, RichTextRendererClient } from '@/features/rich-text/public'

export {
  CommentDeletedError,
  EditWindowExpired,
  InvalidMention,
  InvalidQuoteTarget,
  PostHiddenError,
} from './domain/errors'

// Server Action references viajan client-safe (Next las serializa como
// referencias remotas, no como código del bundle del cliente).
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

export {
  POST_LIST_FILTERS,
  parsePostListFilter,
  postListFilterSchema,
  type PostListFilter,
} from './domain/filter'

// UI client-safe (Client Components con `'use client'` o Server Components
// puros sin imports server-only). Los componentes Server que importan
// queries/aggregations server-only viajan via `public.server.ts`.
//
// stub F.1: PostComposer + RichTextRenderer eliminados. F.3-F.4 reintroducen
// los composers/renderers Lexical desde el slice `rich-text/`.
export { DwellTracker } from './ui/dwell-tracker'
export { PostUnreadDot } from './ui/post-unread-dot'
export { PostAdminMenu } from './ui/post-admin-menu'
export { ReactionBar } from './ui/reaction-bar'
export { ThreadHeaderBar } from './ui/thread-header-bar'
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
  type UnhidePostInput,
  type UnreactInput,
} from './schemas'
