import type { AppShellLabels } from "@/shared/ui/app-shell/public";

// Contract de textos del shell de navegación del settings (zona place).
// Extiende `AppShellLabels` (primitivo agnóstico, ADR-0023) con las 7
// strings dominio-específicas del settings (title del header + 6 items del
// sidebar). La page Server (`(app)/place/[placeSlug]/settings/page.tsx`,
// S6) traduce el namespace `placeSettings` con `getTranslations({locale:
// place.defaultLocale})` — i18n DB-based, no path-based (ADR-0024 + spec
// §"i18n del place") — y entrega un único objeto serializable al Client.
//
// Estructura del extends:
// - heredadas de AppShellLabels (frame reusable): `comingSoon`, `openMenu`,
//   `closeMenu`, `accountMenuButton`, `accountMenuLogout`,
//   `accountMenuLogoutPending`.
// - propias del settings (dominio): `title` (= title del header del shell,
//   "Configurar tu lugar" en es.json), `sidebarLanguage` /
//   `sidebarMembers` / `sidebarAppearance` / `sidebarHours` /
//   `sidebarBilling` / `sidebarDomain` (labels de los 6 items del sidebar;
//   sólo "language" es navegable en V1, el resto `disabled` con tooltip).
//
// Diferencia semántica con NavHubLabels: el `title` acá no es marca/app
// name sino título de zona ("Configurar tu lugar"). El shell lo renderea
// idéntico (header text + aria-label del nav), pero el dominio del string
// es distinto. Por eso la clave se llama `title` y no `appName`.
//
// El helper `buildNavPlaceSidebarItems(labels)` (en `nav-place-items.tsx`)
// mapea estas 7 keys + íconos del settings al `SidebarItem[]` agnóstico
// que consume `<AppShell>`. El cableado de `labels.title` como `title` del
// shell se hace en `NavPlaceLayout`.

export interface NavPlaceLabels extends AppShellLabels {
  /** Título visible en la topbar y aria-label del nav del sidebar. */
  title: string;
  /** Labels de los 6 items del sidebar. */
  sidebarLanguage: string;
  sidebarMembers: string;
  sidebarAppearance: string;
  sidebarHours: string;
  sidebarBilling: string;
  sidebarDomain: string;
}

/**
 * Sección activa del settings. V1: sólo "language" es navegable; el resto
 * vive `disabled: true` (spec §"Sidebar" + §"Fuera de V1"). El union type
 * fuerte previene que un consumer pase un `activeSection` que no
 * corresponde a ningún item.
 */
export type NavPlaceActiveSection =
  | "language"
  | "members"
  | "appearance"
  | "hours"
  | "billing"
  | "domain";
