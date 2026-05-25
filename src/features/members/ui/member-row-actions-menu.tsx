"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { ContextMenu, type ContextMenuItem } from "@/shared/ui/context-menu";
import type {
  ElevateError,
  elevateToOwnerAction,
  RevokeError,
  revokeOwnershipAction,
  TransferError,
  transferFounderOwnershipAction,
} from "@/features/members-ownership/public";

import type { removeMemberAction } from "../actions/remove-member";
import type { Member, RemoveMemberError } from "../types";

// `<MemberRowActionsMenu />` — Feature E V1 §S10. Context menu per-fila
// que canaliza las 4 ownership/membership actions (`elevate`, `revoke`,
// `remove`, `transfer`). Matriz role × role + flows canónicos en spec.md
// §"UI screens" S10 y tests.md §S10 (`<MemberRowActionsMenu />`).
//
// Decisiones que no son derivables de la matriz pública:
//   - Sólo el founder eleva (UI restrictiva V1; DEFINER permite cualquier
//     owner — relajar V1.1+ es trivial).
//   - Self-row sin acciones: defense-in-depth UX sobre `cannot_self_revoke`
//     + founder no auto-revoca V1.
//   - Sin trigger cuando items=[]: evita botón "⋯" fantasma.
//   - Elevate ejecuta directo (reversible). Remove/revoke/transfer abren
//     ConfirmDialog. `destructive=true` para remove+revoke; transfer es
//     sensible pero NO destructive estética (es "transferir", no "borrar").
//
// Seam-split canónico: 4 actions inyectadas vía `actions` bag (tests
// `vi.fn()`); strings ES hardcoded via `labels` (i18n diferida a S11).

export interface MemberRowActionsMenuLabels {
  /** Aria label del trigger, template con `{name}`. */
  triggerLabel: string;
  elevateLabel: string;
  removeLabel: string;
  revokeOwnershipLabel: string;
  transferFounderLabel: string;
  confirmRemoveTitle: string;
  /** Template con `{name}`. */ confirmRemoveBody: string;
  confirmRevokeTitle: string;
  /** Template con `{name}`. */ confirmRevokeBody: string;
  confirmTransferTitle: string;
  /** Template con `{name}`. */ confirmTransferBody: string;
  confirmYes: string;
  confirmNo: string;
  errorUnauthorized: string;
  errorNotOwner: string;
  errorNotFounder: string;
  errorTargetIsOwner: string;
  errorCannotSelfRemove: string;
  errorTargetNotActiveMember: string;
  errorCannotRevokeFounder: string;
  errorCannotSelfRevoke: string;
  errorLastOwner: string;
  errorTargetNotOwner: string;
  errorTargetAlreadyOwner: string;
  errorTargetNotMember: string;
  errorCannotTransferToSelf: string;
  errorPlaceNotFound: string;
  errorGeneric: string;
}

export type MemberRowActionsMenuCallerContext = {
  userId: string;
  isOwner: boolean;
  isFounder: boolean;
};

export type MemberRowActionsMenuActions = {
  elevateAction: typeof elevateToOwnerAction;
  revokeOwnershipAction: typeof revokeOwnershipAction;
  removeAction: typeof removeMemberAction;
  transferFounderAction: typeof transferFounderOwnershipAction;
};

type ConfirmKind = "remove" | "revoke" | "transfer";

function elevateErrorLabel(
  e: ElevateError,
  l: MemberRowActionsMenuLabels,
): string {
  const map: Record<ElevateError, string> = {
    unauthorized: l.errorUnauthorized,
    not_owner: l.errorNotOwner,
    place_not_found: l.errorPlaceNotFound,
    target_not_member: l.errorTargetNotMember,
    target_already_owner: l.errorTargetAlreadyOwner,
    generic: l.errorGeneric,
  };
  return map[e] ?? l.errorGeneric;
}

function removeErrorLabel(
  e: RemoveMemberError,
  l: MemberRowActionsMenuLabels,
): string {
  const map: Record<RemoveMemberError, string> = {
    unauthorized: l.errorUnauthorized,
    not_owner: l.errorNotOwner,
    target_is_owner: l.errorTargetIsOwner,
    cannot_self_remove: l.errorCannotSelfRemove,
    target_not_active_member: l.errorTargetNotActiveMember,
    generic: l.errorGeneric,
  };
  return map[e] ?? l.errorGeneric;
}

function revokeErrorLabel(
  e: RevokeError,
  l: MemberRowActionsMenuLabels,
): string {
  const map: Record<RevokeError, string> = {
    unauthorized: l.errorUnauthorized,
    not_owner: l.errorNotOwner,
    target_not_owner: l.errorTargetNotOwner,
    cannot_revoke_founder: l.errorCannotRevokeFounder,
    cannot_self_revoke: l.errorCannotSelfRevoke,
    last_owner: l.errorLastOwner,
    generic: l.errorGeneric,
  };
  return map[e] ?? l.errorGeneric;
}

function transferErrorLabel(
  e: TransferError,
  l: MemberRowActionsMenuLabels,
): string {
  const map: Record<TransferError, string> = {
    unauthorized: l.errorUnauthorized,
    not_founder: l.errorNotFounder,
    place_not_found: l.errorPlaceNotFound,
    target_not_owner: l.errorTargetNotOwner,
    cannot_transfer_to_self: l.errorCannotTransferToSelf,
    generic: l.errorGeneric,
  };
  return map[e] ?? l.errorGeneric;
}

export function MemberRowActionsMenu({
  member,
  callerCtx,
  placeId,
  placeSlug,
  actions,
  labels,
}: {
  member: Member;
  callerCtx: MemberRowActionsMenuCallerContext;
  placeId: string;
  placeSlug: string;
  actions: MemberRowActionsMenuActions;
  labels: MemberRowActionsMenuLabels;
}) {
  const [confirming, setConfirming] = useState<ConfirmKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSelf = member.userId === callerCtx.userId;
  const input = { placeId, targetUserId: member.userId };

  async function handleElevate() {
    setBusy(true);
    setError(null);
    try {
      const res = await actions.elevateAction(input, placeSlug);
      if (!res.ok) setError(elevateErrorLabel(res.error, labels));
    } catch {
      setError(labels.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!confirming) return;
    setBusy(true);
    setError(null);
    try {
      if (confirming === "remove") {
        const res = await actions.removeAction(input, placeSlug);
        if (!res.ok) setError(removeErrorLabel(res.error, labels));
      } else if (confirming === "revoke") {
        const res = await actions.revokeOwnershipAction(input, placeSlug);
        if (!res.ok) setError(revokeErrorLabel(res.error, labels));
      } else {
        const res = await actions.transferFounderAction(input, placeSlug);
        if (!res.ok) setError(transferErrorLabel(res.error, labels));
      }
    } catch {
      setError(labels.errorGeneric);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  const items: ContextMenuItem[] = [];
  if (callerCtx.isOwner && !isSelf) {
    if (!member.isOwner) {
      if (callerCtx.isFounder) {
        items.push({
          key: "elevate",
          label: labels.elevateLabel,
          onClick: handleElevate,
          disabled: busy,
        });
      }
      items.push({
        key: "remove",
        label: labels.removeLabel,
        onClick: () => setConfirming("remove"),
        destructive: true,
        disabled: busy,
      });
    } else if (!member.isFounder) {
      items.push({
        key: "revoke",
        label: labels.revokeOwnershipLabel,
        onClick: () => setConfirming("revoke"),
        destructive: true,
        disabled: busy,
      });
      if (callerCtx.isFounder) {
        items.push({
          key: "transfer",
          label: labels.transferFounderLabel,
          onClick: () => setConfirming("transfer"),
          disabled: busy,
        });
      }
    }
  }

  if (items.length === 0) {
    return error !== null ? (
      <p role="alert" className="text-xs text-[--accent-strong]">
        {error}
      </p>
    ) : null;
  }

  let confirmTitle = "";
  let confirmBody = "";
  let confirmDestructive = false;
  if (confirming === "remove") {
    confirmTitle = labels.confirmRemoveTitle;
    confirmBody = labels.confirmRemoveBody.replace("{name}", member.displayName);
    confirmDestructive = true;
  } else if (confirming === "revoke") {
    confirmTitle = labels.confirmRevokeTitle;
    confirmBody = labels.confirmRevokeBody.replace("{name}", member.displayName);
    confirmDestructive = true;
  } else if (confirming === "transfer") {
    confirmTitle = labels.confirmTransferTitle;
    confirmBody = labels.confirmTransferBody.replace(
      "{name}",
      member.displayName,
    );
    confirmDestructive = false;
  }

  const triggerLabel = labels.triggerLabel.replace("{name}", member.displayName);

  return (
    <div className="flex flex-col items-end gap-1">
      <ContextMenu
        triggerLabel={triggerLabel}
        trigger={<span aria-hidden="true">⋯</span>}
        items={items}
      />
      {error !== null && (
        <p role="alert" className="text-xs text-[--accent-strong]">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={handleConfirm}
        title={confirmTitle}
        description={confirmBody}
        confirmLabel={labels.confirmYes}
        cancelLabel={labels.confirmNo}
        destructive={confirmDestructive}
        busy={busy}
      />
    </div>
  );
}
