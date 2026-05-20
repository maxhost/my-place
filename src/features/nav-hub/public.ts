// Interfaz pública del slice `nav-hub` (paradigma vertical-slice
// `docs/architecture.md` §17-25: los demás features / rutas importan SÓLO
// desde acá, nunca de internos).
//
// V1 (S3 del Hub, `docs/features/inbox/spec.md`): shell de navegación del
// `app.place.community` — topbar + sidebar mobile-first + drawer + logout
// action. La vista de "Tus lugares" la trae el slice `inbox` (S4); este
// slice sólo provee el frame reusable por todas las vistas del subdomain
// `app.*` (futuro: `/dms`, `/actividad`).

export { NavHubLayout } from "./ui/nav-hub-layout";
export type {
  NavHubLabels,
  NavHubActiveSection,
} from "./ui/nav-hub-labels";
export { logoutAction } from "./actions/logout-action";
