import { describe, expect, it } from "vitest";

import esMessages from "@/i18n/messages/es.json";

// Defense contra typos en el catálogo `placeMembers.*` (Feature E V1 §S11,
// plan-sesiones.md §S11 + tests.md §S11). El page `/settings/members`
// (`src/app/(app)/place/[placeSlug]/settings/members/page.tsx`) construye
// los 5 *Labels obj con `t('placeMembers.<key>')`; este test fija la lista
// de keys esperadas y verifica que cada path exista como hoja en
// `es.json.placeMembers`. Cubre 2 modos de falla:
//
//   1. Typo en `t('placeMembers.xxx')` (mismatch contra el JSON).
//   2. Drift al renombrar una key del JSON sin actualizar el page.
//
// El segundo caso (parity ×6 locales) lo cubre el script informativo
// `scripts/check-translations.mjs` (ADR-0024 — deep-merge runtime evita
// keys crudas, drift se reporta sin fail-closed). NO duplicamos esa
// verificación acá: el script ya enumera diferencias por path y este
// archivo se mantendría desincronizado con cada locale nuevo.
//
// **Mantenimiento**: si se agrega una key nueva al catálogo, agregarla a
// `EXPECTED_KEYS` + a `es.json` + (opcional) traducirla en los otros 5.
// Si esto se vuelve doloroso (catálogo crece >150 keys), considerar
// generar `EXPECTED_KEYS` desde el JSON y testear que cada key esté
// referenciada en el código (test inverso) — V1 acá el approach manual
// es suficiente.

// Source of truth de las keys que el page S11 consume — espejo de los
// `*Labels` interfaces de los 5 componentes UI (members-list 4 + actions-
// menu 12 remover-only post ADR-0054 + invite-modal 17 + pending 14 +
// headline 11) + 4 page-level (pageTitle, tabActive, tabPending,
// inviteButton). Total 62 keys.
const EXPECTED_KEYS: readonly string[] = [
  // Page-level header + tabs + CTA invite
  "pageTitle",
  "tabActive",
  "tabPending",
  "inviteButton",
  // MembersListLabels (4) — keys flat bajo `list.*` espejan el interface
  "list.emptyTitle",
  "list.emptyDescription",
  "list.badgeFounder",
  "list.badgeOwner",
  // MemberRowActionsMenuLabels (12, remover-only post ADR-0054)
  "actionsMenu.triggerLabel",
  "actionsMenu.removeLabel",
  "actionsMenu.confirmRemoveTitle",
  "actionsMenu.confirmRemoveBody",
  "actionsMenu.confirmYes",
  "actionsMenu.confirmNo",
  "actionsMenu.errorUnauthorized",
  "actionsMenu.errorNotOwner",
  "actionsMenu.errorTargetIsOwner",
  "actionsMenu.errorCannotSelfRemove",
  "actionsMenu.errorTargetNotActiveMember",
  "actionsMenu.errorGeneric",
  // InviteMemberModalLabels (17)
  "inviteModal.title",
  "inviteModal.description",
  "inviteModal.emailLabel",
  "inviteModal.emailPlaceholder",
  "inviteModal.expiresLabel",
  "inviteModal.submitButton",
  "inviteModal.submitting",
  "inviteModal.successHeading",
  "inviteModal.copyButton",
  "inviteModal.copiedTooltip",
  "inviteModal.closeButton",
  "inviteModal.errorInvalidEmail",
  "inviteModal.errorInvalidExpires",
  "inviteModal.errorUnauthorized",
  "inviteModal.errorNotOwner",
  "inviteModal.errorExpiresInPast",
  "inviteModal.errorGeneric",
  // PendingInvitationsTabLabels (14)
  "pending.emptyTitle",
  "pending.emptyDescription",
  "pending.invitedByPrefix",
  "pending.expiresLabel",
  "pending.revokeButton",
  "pending.confirmTitle",
  "pending.confirmBody",
  "pending.confirmYes",
  "pending.confirmNo",
  "pending.errorUnauthorized",
  "pending.errorNotOwner",
  "pending.errorNotFound",
  "pending.errorAlreadyAccepted",
  "pending.errorGeneric",
  // HeadlineEditorLabels (11)
  "headline.viewEditButton",
  "headline.emptyCta",
  "headline.inputLabel",
  "headline.inputPlaceholder",
  "headline.saveButton",
  "headline.cancelButton",
  "headline.saving",
  "headline.counterTemplate",
  "headline.errorTooLong",
  "headline.errorUnauthorized",
  "headline.errorNotMember",
  "headline.errorGeneric",
];

function resolveKey(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, segment) => {
    if (acc !== null && typeof acc === "object" && segment in acc) {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, obj);
}

describe("placeMembers i18n catalog (es.json)", () => {
  const messages = esMessages as unknown as Record<string, unknown>;
  const placeMembers = messages.placeMembers as Record<string, unknown> | undefined;

  it("namespace `placeMembers` existe en es.json", () => {
    expect(placeMembers).toBeDefined();
    expect(typeof placeMembers).toBe("object");
  });

  it.each(EXPECTED_KEYS)(
    "key `placeMembers.%s` existe como hoja string",
    (key) => {
      expect(placeMembers).toBeDefined();
      const value = resolveKey(placeMembers as Record<string, unknown>, key);
      expect(value, `placeMembers.${key} should be defined`).toBeDefined();
      expect(
        typeof value,
        `placeMembers.${key} should be a string leaf, got ${typeof value}`,
      ).toBe("string");
    },
  );
});
