// Interfaz pública del slice `inbox` (paradigma vertical-slice
// `docs/architecture.md` §17-25: los demás features / rutas importan SÓLO
// desde acá, nunca de internos).
//
// V1 (sesión 2 del Hub, docs/features/inbox/): expone los tipos del payload
// del Hub y el wrapper de la stored function `app.get_inbox_payload()`. La
// UI del Hub (PlacesView, PlaceCard, EmptyState, etc.) se agrega en la
// sesión 4 y se exporta acá entonces.

export { getInboxPayload, parseInboxPayload } from "./queries/get-inbox-payload";
export type {
  RawInboxPayload,
  RawInboxPlace,
} from "./queries/get-inbox-payload";
export type {
  InboxPayload,
  InboxPlace,
  PlaceStatus,
} from "./domain/inbox-payload";
export { PLACE_STATUSES } from "./domain/inbox-payload";
