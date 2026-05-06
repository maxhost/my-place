/**
 * API pública del sub-slice `discussions/comments/`.
 *
 * Comments CRUD + UI (composer, item, thread, admin menu, quote) +
 * realtime hook. Depende de posts/ para findQuoteSource (validación
 * cross-sub-slice via public).
 */

// stub F.1: CommentComposer eliminado. F.3 reintroduce el composer Lexical
// desde el slice `rich-text/`.
export { CommentAdminMenu } from './ui/comment-admin-menu'
export { CommentItem } from './ui/comment-item'
export { CommentThread } from './ui/comment-thread'
export { CommentThreadLive } from './ui/comment-thread-live'
export { LoadMoreComments } from './ui/load-more-comments'
export { useCommentRealtime } from './ui/use-comment-realtime'
export { QuoteButton } from './ui/quote-button'
export { QuotePreview } from './ui/quote-preview'
export { useQuoteStore } from './ui/quote-store'

export {
  createCommentAction,
  deleteCommentAction,
  editCommentAction,
  openCommentEditSession,
} from './server/actions'
