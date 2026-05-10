import 'server-only'

/**
 * Superficie pública server-only del slice `discussions`. Los consumidores
 * client-safe siguen viviendo en `public.ts`; lo que importa Prisma
 * directamente (hard delete polimórfico) sale por acá para que el bundler de
 * Next no lo trace al bundle cliente. Ver
 * `docs/decisions/2026-04-21-flags-subslice-split.md` §"Boundary client vs
 * server".
 */

export { hardDeletePost } from './server/hard-delete'

// Helper transaccional para que slices vecinos (events) puedan crear un Post
// como thread asociado bajo la misma tx que su objeto raíz. Ver
// docs/features/events/spec-integrations.md § 1.2.
export {
  createPostFromSystemHelper,
  type CreatePostFromSystemInput,
} from './server/actions/posts/create-from-system'

// Resolución del actor con membership activa, expuesta para que otros slices
// (events) reusen la lógica de gate sin reimplementar (membership +
// ownership + place archivado check, todo cached por request). El nombre
// `DiscussionActor` es legacy del slice donde fue introducido — el shape
// es genérico y el alias `Viewer` lo refleja. Ver
// `docs/decisions/2026-04-20-request-scoped-identity-cache.md`.
export {
  resolveActorForPlace,
  resolveViewerForPlace,
  type DiscussionActor,
  type DiscussionViewer,
} from './server/actor'

// Queries Prisma + page size constants. Viven server-only porque
// importan `import 'server-only'` directo o transitivo. Cualquier
// Server Component / Server Action que las necesite las consume desde
// este barrel; Client Components pasan por `public.ts` (sin queries).
export {
  COMMENT_PAGE_SIZE,
  POST_PAGE_SIZE,
  findCommentById,
  findPostById,
  findPostBySlug,
  listCommentsByPost,
  listPostsByPlace,
  type CommentView,
} from './server/queries'

// Presence (sub-slice). Re-export para mantener la superficie pública del
// slice estable mientras los callers externos siguen importando desde
// `discussions/public.server`. La copia legacy en `./server/queries` queda
// sin consumers internos hasta B.1 (ver `docs/plans/2026-05-09-presence-subslice-migration.md`).
export {
  findOrCreateCurrentOpening,
  listReadersByPost,
  type PostReader,
} from './presence/public.server'

// Tipo `Post` re-exportado para Server Components consumidores
// (pages que pre-fetchean post via `findPostBySlug` y lo pasan a
// componentes streamed bajo `<Suspense>`). Ver patrón canónico en
// `docs/architecture.md` § "Streaming agresivo del shell".
export type { Post } from './domain/types'

export {
  aggregateReactions,
  reactionMapKey,
  type AggregatedReaction,
  type ReactionAggregationMap,
} from './server/reactions-aggregation'

// Server Components que importan queries/aggregation server-only directo.
// No pueden viajar via `public.ts` porque Next traza los imports al bundle
// del cliente cuando algún Client Component los importa transitivamente.
export { CommentThread } from './ui/comment-thread'
export { PostDetail } from './ui/post-detail'
export { PostList } from './threads/public'
export { PostReadersBlock } from './presence/public'

// Sesión 5.3: helpers de invalidación tag-based para el cache de
// `aggregateReactions`. Llamados desde `reactAction`/`unreactAction`.
export {
  postReactionsTag,
  commentReactionsTag,
  revalidateReactionsForPost,
  revalidateReactionsForComment,
} from './server/reactions-cache'
