import type { AppShellLabels } from "@/shared/ui/app-shell/public";

// Contract de textos del shell de navegación del settings (zona place).
// V1.1 (ADR-0025): extiende `AppShellLabels` (primitivo agnóstico, ADR-0023)
// con 14 strings dominio-específicas del settings: title del header + 4
// labels de grupos conceptuales + 9 labels de items del sidebar.
//
// Estructura del extends:
// - heredadas de AppShellLabels (frame reusable): `comingSoon`, `openMenu`,
//   `closeMenu`, `accountMenuButton`, `accountMenuLogout`,
//   `accountMenuLogoutPending`.
// - propias del settings (dominio V1.1):
//   - `title` (= title del header del shell, "Configurar tu lugar" en
//     es.json).
//   - `groupIdentity` / `groupStructure` / `groupSubscription` /
//     `groupManagement` (V1.1 — headers fijos no-colapsables de los 4 grupos
//     conceptuales del sidebar, ADR-0025 §1).
//   - `sidebarLanguage` / `sidebarMembers` / `sidebarAppearance` /
//     `sidebarHours` / `sidebarBilling` / `sidebarDomain` / **`sidebarZones`**
//     / **`sidebarGroups`** / **`sidebarTiers`** (labels de los 9 items del
//     sidebar; sólo "language" es navegable en V1, los otros 8 viven
//     `disabled` con tooltip "Próximamente").
//
// **Renombres y novedades V1.1** (vs V1, ADR-0025):
// - Item "Dominio custom" → "Dominio" (`sidebarDomain` value cambia, key
//   se mantiene).
// - **Items nuevos V1.1**: `sidebarZones`, `sidebarGroups`, `sidebarTiers`.
// - **Group labels nuevos V1.1**: `groupIdentity`, `groupStructure`,
//   `groupSubscription`, `groupManagement`.
//
// **Cableado i18n del consumer**: la page Server traduce el namespace
// `placeSettings` con `getTranslations({locale: place.defaultLocale})` y
// entrega el objeto serializable al Client. La S3 del plan-sesiones del
// sidebar V1.1 reemplaza los literales transitorios del page por las 7
// keys i18n nuevas (`placeSettings.sidebar.group*` + `placeSettings.sidebar.
// {zones,groups,tiers}`) y agrega paridad ×6 locales con
// `scripts/check-translations.mjs`.
//
// Diferencia semántica con NavHubLabels: el `title` acá no es marca/app
// name sino título de zona ("Configurar tu lugar"). El shell lo renderea
// idéntico (header text + aria-label del nav), pero el dominio del string
// es distinto. Por eso la clave se llama `title` y no `appName`.
//
// El helper `buildNavPlaceSidebarGroups(labels)` (en `nav-place-items.tsx`)
// mapea estas keys + iconos del settings al `SidebarGroup[]` agnóstico que
// consume `<AppShell>`. El cableado de `labels.title` como `title` del
// shell se hace en `NavPlaceLayout`.

export interface NavPlaceLabels extends AppShellLabels {
  /** Título visible en la topbar y aria-label del nav del sidebar. */
  title: string;
  /** Labels de los 4 grupos conceptuales (V1.1, ADR-0025). */
  groupIdentity: string;
  groupStructure: string;
  groupSubscription: string;
  groupManagement: string;
  /** Labels de los 9 items del sidebar (V1.1 = V1 6 + 3 nuevos). */
  sidebarLanguage: string;
  sidebarMembers: string;
  sidebarAppearance: string;
  sidebarHours: string;
  sidebarBilling: string;
  sidebarDomain: string;
  sidebarZones: string;
  sidebarGroups: string;
  sidebarTiers: string;
}

/**
 * Sección activa del settings. V1.1: sólo "language" es navegable; los 8
 * restantes viven `disabled: true` (spec §"Sidebar V1.1 agrupado" + §"Fuera
 * de V1"). El union type fuerte previene que un consumer pase un
 * `activeSection` que no corresponde a ningún item del slice.
 *
 * Items NUEVOS V1.1 incluidos en el union (aún disabled): `zones`,
 * `groups`, `tiers`. Cuando se activen (S4+ posteriores), basta con
 * cambiar el `disabled` del item correspondiente — el union ya los
 * acepta.
 */
export type NavPlaceActiveSection =
  | "language"
  | "members"
  | "appearance"
  | "hours"
  | "billing"
  | "domain"
  | "zones"
  | "groups"
  | "tiers";
