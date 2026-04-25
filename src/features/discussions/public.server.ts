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
