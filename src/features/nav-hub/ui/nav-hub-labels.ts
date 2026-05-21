import type { AppShellLabels } from "@/shared/ui/app-shell/public";

// Contract de textos del shell de navegación del Hub. Extiende
// `AppShellLabels` (primitivo agnóstico, ADR-0023) con las 4 strings
// dominio-específicas del Hub (appName + 3 items del sidebar). El page
// Server (`(app)/inbox/[locale]/page.tsx`) traduce el namespace `navHub`
// con `getTranslations()` y entrega un único objeto serializable al Client
// — patrón canónico del repo (paralelo a `WizardLabels`, `AccessLabels`).
//
// Estructura del extends:
// - heredadas de AppShellLabels (frame reusable): `comingSoon`, `openMenu`,
//   `closeMenu`, `accountMenuButton`, `accountMenuLogout`,
//   `accountMenuLogoutPending`.
// - propias del Hub (dominio): `appName` (= title del header del shell),
//   `sidebarPlaces` / `sidebarMessages` / `sidebarActivity` (labels de los
//   3 items del sidebar; sólo "places" es navegable en V1).
//
// El helper `buildNavHubSidebarItems(labels)` (en `nav-hub-items.tsx`)
// mapea estas 4 keys + íconos del Hub al `SidebarItem[]` agnóstico que
// consume `<AppShell>`. El cableado de `labels.appName` como `title` del
// shell se hace en `NavHubLayout`.

export interface NavHubLabels extends AppShellLabels {
  /** Marca / título visible en la topbar (también `title` del shell). */
  appName: string;
  /** Items del sidebar. */
  sidebarPlaces: string;
  sidebarMessages: string;
  sidebarActivity: string;
}

/** Sección activa del hub. V1: sólo "places" es navegable. */
export type NavHubActiveSection = "places" | "messages" | "activity";
