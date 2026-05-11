/**
 * API pública client-safe del slice `hours`. Tipos puros, helpers de
 * dominio (sin I/O), schemas Zod, server actions (callables desde Client
 * Components) y componentes UI.
 *
 * **No** incluye queries server-only ni helpers que toquen Prisma — viven
 * en `public.server.ts`. Mezclar `import 'server-only'` acá rompería el
 * build cuando un Client Component que viaja al bundle importa de este
 * archivo (ej: `events/ui/event-form.tsx` necesita `ALLOWED_TIMEZONES`).
 *
 * Ver `docs/decisions/2026-04-21-flags-subslice-split.md` § "Boundary
 * client vs server" — mismo patrón.
 */

export type {
  DateException,
  DayOfWeek,
  OpeningHours,
  OpenStatus,
  RecurringWindow,
  TimeOfDay,
} from './domain/types'

export { currentOpeningWindow, isPlaceOpen, nextOpeningWindow } from './domain/invariants'
export { ALLOWED_TIMEZONES, isAllowedTimezone } from './domain/timezones'
export type { AllowedTimezone } from './domain/timezones'
export {
  openingHoursSchema,
  parseOpeningHours,
  updateHoursInputSchema,
  type UpdateHoursInput,
} from './schemas'

export { updatePlaceHoursAction } from './server/actions'

// `HoursForm` vive en `./admin/public` (sub-slice admin). Consumirlo de ahí
// directamente. El re-export top-level se quitó para no servir la versión
// legacy de `./ui/hours-form` (eliminada).
//
// `HoursPreview` y `PlaceClosedView` también viven en sub-slices ahora
// (`./member/public`). El top-level los re-exporta para mantener compat con
// los consumers (`(gated)/layout.tsx`).
export { HoursPreview, PlaceClosedView } from './member/public'
