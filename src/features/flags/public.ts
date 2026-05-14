/**
 * API pública client-safe del slice `flags`. Incluye tipos, domain, errores,
 * schemas Zod, Server Actions (callables desde client RSC) y componentes UI.
 *
 * **No** incluye queries server-only (ver `public.server.ts`) — Next traza los
 * re-exports a través del bundle cliente cuando un Server Component que viaja
 * a un Client Component importa este archivo. Mezclar `import 'server-only'`
 * acá rompería el build.
 *
 * Ver `docs/decisions/2026-04-21-flags-subslice-split.md`.
 */

export type {
  ContentTargetKind,
  Flag,
  FlagContentStatus,
  FlagId,
  FlagReason,
  FlagStatus,
  FlagTargetSnapshot,
  FlagView,
} from './domain/types'

export { FLAG_NOTE_MAX_LENGTH, FLAG_PAGE_SIZE, FLAG_PREVIEW_MAX_CHARS } from './domain/invariants'

export { FlagAlreadyExists } from './domain/errors'

export { mapFlagToView } from './server/flag-view-mapper'

export { flagAction, reviewFlagAction } from './server/actions'

export {
  flagInputSchema,
  reviewFlagInputSchema,
  type FlagInput,
  type ReviewFlagInput,
} from './schemas'

export { FlagButton } from './ui/flag-button'
