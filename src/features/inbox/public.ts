// Interfaz pública del slice `inbox` (paradigma vertical-slice
// `docs/architecture.md` §17-25: los demás features / rutas importan SÓLO
// desde acá, nunca de internos).
//
// V1 del Hub (`docs/features/inbox/`):
// - S2 (DB): wrapper de la stored function `app.get_inbox_payload()` + tipos
//   del dominio (`InboxPayload`, `InboxPlace`, `PlaceStatus`).
// - S4 (UI): vista "Tus lugares" del Hub (`<PlacesView />`) + la interface
//   `InboxLabels` que el page del Hub (S5) construye desde i18n y pasa como
//   prop. Los componentes internos (`<PlaceCard />`, `<EmptyState />`,
//   `<PlaceStatusBadge />`) no se exportan: son detalle de implementación
//   del slice, sólo `<PlacesView />` es el contract público.

// Query + tipos del payload (S2)
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

// UI del Hub (S4)
export { PlacesView } from "./ui/places-view";
export type { InboxLabels } from "./ui/inbox-labels";
