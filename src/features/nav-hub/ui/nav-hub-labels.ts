// Contract de textos del shell de navegación del hub (S3 del Hub V1,
// `docs/features/inbox/spec.md`). Separado del componente para que la page
// Server cargue i18n y pase un objeto serializable al Client (patrón canónico
// del repo: `WizardLabels`, `AccessLabels`).
//
// El nav-hub NO carga i18n en runtime cliente: la page Server traduce el
// namespace `navHub` con `getTranslations()` y entrega el objeto ya armado.
// Los componentes son puros render — facilita testing (props serializables,
// sin mocks de next-intl).

export interface NavHubLabels {
  /** Marca / título visible en la topbar. */
  appName: string;
  /** Items del sidebar. */
  sidebarPlaces: string;
  sidebarMessages: string;
  sidebarActivity: string;
  /** Tooltip para items disabled (`aria-disabled="true"`). */
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

/** Sección activa del hub. V1: sólo "places" es navegable. */
export type NavHubActiveSection = "places" | "messages" | "activity";
