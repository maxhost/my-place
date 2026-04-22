/**
 * API pública del slice `hours`. Único punto de entrada desde otras partes del sistema.
 * Ver `docs/architecture.md` § boundaries y `docs/features/hours/spec.md`.
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

export { findPlaceHours, assertPlaceOpenOrThrow } from './server/queries'
export { updatePlaceHoursAction } from './server/actions'

export { HoursForm, type HoursFormDefaults } from './ui/hours-form'
export { HoursPreview } from './ui/hours-preview'
export { PlaceClosedView } from './ui/place-closed-view'
