// Contract de strings i18n que el slice `inbox` necesita para renderear su
// UI (S4 del Hub V1, `docs/features/inbox/spec.md` §i18n keys). El page
// Server invoca `getTranslations({locale, namespace: "inbox"})`, arma el
// objeto `InboxLabels` y lo pasa como prop a los Client Components — el
// slice no carga i18n en runtime (mismo patrón que `WizardLabels` /
// `NavHubLabels`).
//
// `cardMemberSince` lleva el placeholder `{date}` que el componente rellena
// client-side con `Intl.DateTimeFormat(locale, …)` (mismo locale que vino del
// page, prop separada). No se incluye `errorLoad`/`errorReload` (los consume
// el page del Hub a nivel error-boundary en S5, no este slice).

/** Strings que renderea la UI del slice `inbox` en su locale activo. */
export interface InboxLabels {
  /** Título de la vista (heading `<h1>` dentro de `<PlacesView>`). */
  viewTitle: string;
  /** Botón primario de la card cuando `status === "ACTIVE"`. */
  cardEnter: string;
  /** Botón secundario de la card cuando `status === "ACTIVE"` && owner. */
  cardSettings: string;
  /**
   * Template con `{date}` placeholder. Se reemplaza client-side con la fecha
   * formateada por `Intl.DateTimeFormat(locale, { month: "long", year: "numeric" })`.
   * Ejemplo en `es`: "Miembro desde marzo 2024".
   */
  cardMemberSince: string;
  statusPaymentPending: string;
  statusInactivationProcess: string;
  statusInactive: string;
  emptyTitle: string;
  emptyBody: string;
  emptyCreateAction: string;
  /** Label del CTA secundario del empty state (V1 disabled). */
  emptyJoinAction: string;
  /** Tooltip + texto auxiliar del CTA disabled. */
  emptyJoinComingSoon: string;
}
