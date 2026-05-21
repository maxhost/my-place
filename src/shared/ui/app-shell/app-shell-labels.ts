import type { ReactNode } from "react";

// Contrato i18n + shape de items del shell agnóstico (ADR-0023). Vive en
// `shared/ui/app-shell/` para que `nav-hub` y `nav-place` (S5) lo consuman
// vía `public.ts`. Los slices NO cargan i18n en runtime cliente: la page
// Server traduce su namespace (`navHub`, `navPlace`) con `getTranslations()`
// y entrega el objeto serializable a `<AppShell>`. Pattern canónico del repo
// (paralelo a `NavHubLabels`, `WizardLabels`, `AccessLabels`).
//
// Por qué `AppShellLabels` (≠ `NavHubLabels`):
// - `AppShellLabels` contiene SÓLO las strings reusables del frame (drawer
//   toggle, account menu, tooltip de items disabled). NO contiene strings
//   específicas del Hub (sidebarPlaces/Messages/Activity) ni del settings
//   (sidebar.language/members/etc.).
// - El `title` del header y los labels de cada `SidebarItem` viajan como
//   props del consumer (no del contract i18n del shell): cambian por
//   render según la zona, no son configurables como i18n keys del frame.
// - Inversión de dependencia: el shell no conoce namespaces ni next-intl.

export interface AppShellLabels {
  /** Tooltip + título nativo para items con `disabled: true`. */
  comingSoon: string;
  /** Aria-label del trigger del drawer (hamburger). */
  openMenu: string;
  /** Aria-label del botón de cierre del drawer. */
  closeMenu: string;
  /** Aria-label del botón del avatar que abre el account menu. */
  accountMenuButton: string;
  /** Texto del item de logout dentro del account menu. */
  accountMenuLogout: string;
  /** Texto del logout mientras la action está en vuelo. */
  accountMenuLogoutPending: string;
}

/**
 * Shape de un item del sidebar. Render rules (runtime, no de tipos):
 * - `disabled === true` → `<span aria-disabled="true" title={labels.comingSoon}>`.
 *   El `href` se ignora aunque venga; el item NO es navegable.
 * - `key === activeKey` → `<a href={href} aria-current="page">`. `href` requerido.
 * - default → `<a href={href}>` regular. `href` requerido.
 *
 * El consumer (`nav-hub`, `nav-place`) construye el array desde sus labels
 * i18n y conoce qué key es activa. El shell sólo renderea sin lógica de
 * dominio.
 */
export type SidebarItem = {
  key: string;
  label: string;
  href?: string;
  icon?: ReactNode;
  disabled?: boolean;
};

/**
 * Agrupamiento conceptual de items del sidebar (ADR-0025). Render rules:
 * - `label === null` → grupo plano sin header. Los items se rendean directo
 *   debajo del nav. Modo usado por `nav-hub` V1 (todos los items en un único
 *   grupo sin etiqueta).
 * - `label === string` → header fijo (no-colapsable) arriba del grupo. El
 *   shell renderea un `<h2>` visible con el texto del label; NO es widget
 *   interactivo (sin role="button", sin aria-expanded, sin disclosure). Modo
 *   usado por `nav-place` V1.1 (4 grupos: Identidad/Estructura/Suscripción/
 *   Gestión).
 *
 * El consumer arma `SidebarGroup[]` desde su contract i18n; el shell sólo
 * renderea sin lógica de dominio ni decisión de agrupamiento.
 */
export type SidebarGroup = {
  label: string | null;
  items: SidebarItem[];
};
