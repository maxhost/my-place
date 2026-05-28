import type { MembersPageShellLabels } from "../_components/members-page-shell";

// Helper privado del page `/settings/members` (Feature E V1 §S11). Extrae el
// boilerplate de mapeo del namespace `placeMembers.*` al shape
// `MembersPageShellLabels` que consume el shell.
//
// Vive en `_lib/` (private folder Next App Router — convención del árbol
// `(app)/place/[placeSlug]/_lib/`) porque es wiring del page específico:
// no es lógica de dominio (no va a `features/`) ni primitivo UI agnóstico
// (no va a `shared/ui/`). Mismo patrón que `get-place-for-zone.ts` del
// settings.
//
// Motivación: el page.tsx superaba el cap CLAUDE.md §"Límites de tamaño"
// (≤300 LOC) por el peso de 80 traducciones en línea. Extraer este builder
// pinta lo que es: una transformación pura `t → labels` sin condicionales.
// El typecheck garantiza paridad shape `MembersPageShellLabels` vía la
// firma de retorno. Sin tests dedicados — el i18n-keys.test.ts ya verifica
// que cada key exista en es.json, y el page.tsx falla loud si `t()` retorna
// el placeholder de "missing key" (next-intl runtime).

/** Función traductora del namespace `placeMembers` (de `getTranslations`). */
type TMembers = (key: string) => string;

export function buildMembersPageShellLabels(
  t: TMembers,
): MembersPageShellLabels {
  return {
    tabActive: t("tabActive"),
    tabPending: t("tabPending"),
    inviteButton: t("inviteButton"),
    list: {
      emptyTitle: t("list.emptyTitle"),
      emptyDescription: t("list.emptyDescription"),
      badgeFounder: t("list.badgeFounder"),
      badgeOwner: t("list.badgeOwner"),
    },
    actionsMenu: {
      triggerLabel: t("actionsMenu.triggerLabel"),
      elevateLabel: t("actionsMenu.elevateLabel"),
      removeLabel: t("actionsMenu.removeLabel"),
      revokeOwnershipLabel: t("actionsMenu.revokeOwnershipLabel"),
      transferFounderLabel: t("actionsMenu.transferFounderLabel"),
      confirmRemoveTitle: t("actionsMenu.confirmRemoveTitle"),
      confirmRemoveBody: t("actionsMenu.confirmRemoveBody"),
      confirmRevokeTitle: t("actionsMenu.confirmRevokeTitle"),
      confirmRevokeBody: t("actionsMenu.confirmRevokeBody"),
      confirmTransferTitle: t("actionsMenu.confirmTransferTitle"),
      confirmTransferBody: t("actionsMenu.confirmTransferBody"),
      confirmYes: t("actionsMenu.confirmYes"),
      confirmNo: t("actionsMenu.confirmNo"),
      errorUnauthorized: t("actionsMenu.errorUnauthorized"),
      errorNotOwner: t("actionsMenu.errorNotOwner"),
      errorNotFounder: t("actionsMenu.errorNotFounder"),
      errorTargetIsOwner: t("actionsMenu.errorTargetIsOwner"),
      errorCannotSelfRemove: t("actionsMenu.errorCannotSelfRemove"),
      errorTargetNotActiveMember: t("actionsMenu.errorTargetNotActiveMember"),
      errorCannotRevokeFounder: t("actionsMenu.errorCannotRevokeFounder"),
      errorCannotSelfRevoke: t("actionsMenu.errorCannotSelfRevoke"),
      errorLastOwner: t("actionsMenu.errorLastOwner"),
      errorTargetNotOwner: t("actionsMenu.errorTargetNotOwner"),
      errorTargetAlreadyOwner: t("actionsMenu.errorTargetAlreadyOwner"),
      errorTargetNotMember: t("actionsMenu.errorTargetNotMember"),
      errorCannotTransferToSelf: t("actionsMenu.errorCannotTransferToSelf"),
      errorPlaceNotFound: t("actionsMenu.errorPlaceNotFound"),
      errorGeneric: t("actionsMenu.errorGeneric"),
    },
    inviteModal: {
      title: t("inviteModal.title"),
      description: t("inviteModal.description"),
      emailLabel: t("inviteModal.emailLabel"),
      emailPlaceholder: t("inviteModal.emailPlaceholder"),
      expiresLabel: t("inviteModal.expiresLabel"),
      submitButton: t("inviteModal.submitButton"),
      submitting: t("inviteModal.submitting"),
      successHeading: t("inviteModal.successHeading"),
      copyButton: t("inviteModal.copyButton"),
      copiedTooltip: t("inviteModal.copiedTooltip"),
      closeButton: t("inviteModal.closeButton"),
      errorInvalidEmail: t("inviteModal.errorInvalidEmail"),
      errorInvalidExpires: t("inviteModal.errorInvalidExpires"),
      errorUnauthorized: t("inviteModal.errorUnauthorized"),
      errorNotOwner: t("inviteModal.errorNotOwner"),
      errorExpiresInPast: t("inviteModal.errorExpiresInPast"),
      errorRateLimited: t("inviteModal.errorRateLimited"),
      errorGeneric: t("inviteModal.errorGeneric"),
    },
    pending: {
      emptyTitle: t("pending.emptyTitle"),
      emptyDescription: t("pending.emptyDescription"),
      invitedByPrefix: t("pending.invitedByPrefix"),
      expiresLabel: t("pending.expiresLabel"),
      revokeButton: t("pending.revokeButton"),
      confirmTitle: t("pending.confirmTitle"),
      confirmBody: t("pending.confirmBody"),
      confirmYes: t("pending.confirmYes"),
      confirmNo: t("pending.confirmNo"),
      errorUnauthorized: t("pending.errorUnauthorized"),
      errorNotOwner: t("pending.errorNotOwner"),
      errorNotFound: t("pending.errorNotFound"),
      errorAlreadyAccepted: t("pending.errorAlreadyAccepted"),
      errorGeneric: t("pending.errorGeneric"),
    },
  };
}
