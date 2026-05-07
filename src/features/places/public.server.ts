import 'server-only'

/**
 * API pública server-only del slice `places`.
 *
 * Razón del split (gotcha documentada en CLAUDE.md):
 * cuando un Client Component (ej. `OwnersAccessPanel` del slice `members`)
 * importa `TransferOwnershipSheet` desde `@/features/places/public`, Next
 * traza TODO `public.ts` al bundle cliente. Si `public.ts` re-exporta
 * `listMyPlaces` (que tiene `import 'server-only'` en su módulo de queries),
 * el build falla con "You're importing a component that needs server-only".
 *
 * Fix: este archivo agrupa los exports server-only (queries Prisma).
 * Server Components / pages importan de acá; `public.ts` queda
 * client-safe (tipos, schemas, server actions, componentes UI).
 *
 * Ver `docs/decisions/2026-04-21-flags-subslice-split.md` para el patrón
 * canónico (caso original del slice `flags`).
 */

export { listMyPlaces } from './server/queries'

// Helpers de invalidación tag-based para los caches `unstable_cache` que
// envuelven `loadPlaceBySlug`/`loadPlaceById` y `listMyPlaces`. Llamados
// desde mutations propias del slice (`actions.ts`) y de slices vecinos
// (`members/server/actions/*`, `hours/server/actions.ts`,
// `editor-config/server/actions.ts`).
export {
  revalidatePlaceCache,
  revalidateMyPlacesCache,
  placeBySlugTag,
  placeByIdTag,
  myPlacesTag,
} from './server/cache'
