// Interfaz pública del slice `nav-place` (paradigma vertical-slice
// `docs/architecture.md` §17-25: los demás features / rutas importan SÓLO
// desde acá, nunca de internals).
//
// V1 (S5 del feature `settings`, `docs/features/settings/spec.md`): shell
// de navegación de la zona settings del place
// (`{slug}.place.community/settings`). Mobile-first idéntico al Hub V1 vía
// el shell agnóstico `shared/ui/app-shell` (ADR-0023). `nav-place` aporta
// sólo el mapping de labels + 6 items del settings + active-section; el
// frame es del shell. La page consumer (S6) compone:
//
//   <NavPlaceLayout
//     labels={navPlaceLabels}
//     displayName={user.displayName}
//     activeSection="language"
//     onLogout={logoutAction.bind(null, defaultLocale)}
//   >
//     <LocaleSection ... />  {/* slice place-settings, S7 */}
//   </NavPlaceLayout>
//
// Lo que NO se exporta acá (intencional):
// - `buildNavPlaceSidebarItems`: helper interno del wrapper. Si la page
//   necesitara los items, se exporta acá — V1 no lo requiere.
// - íconos (Language/Members/Appearance/Hours/Billing/Domain): privados
//   del slice.
// - `logoutAction`: NO vive en este slice. La page consumer lo importa
//   directamente desde `@/features/nav-hub/public` (slice→slice
//   unidireccional permitido per `docs/architecture.md` §17 +
//   `docs/features/settings/spec.md` §"Dependencias acíclicas"). Reusar
//   la action evita duplicar lógica de logout entre Hub y settings.

export { NavPlaceLayout } from "./ui/nav-place-layout";
export type {
  NavPlaceLabels,
  NavPlaceActiveSection,
} from "./ui/nav-place-labels";
