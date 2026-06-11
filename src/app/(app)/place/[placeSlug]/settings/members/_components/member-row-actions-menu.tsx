"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { ContextMenu, type ContextMenuItem } from "@/shared/ui/context-menu";
import type {
  Member,
  removeMemberAction,
  RemoveMemberError,
} from "@/features/members/public";

// `<MemberRowActionsMenu />` — context menu per-fila de `/settings/members`.
// Post ADR-0054 (un place = un owner) queda remover-only: la única acción es
// `remove` (las ownership actions elevate/revoke/transfer se retiraron junto
// con el slice `place-ownership-actions/`).
//
// **Post S10.9 (ADR-0043)**: vive a page-level co-located en
// `src/app/(app)/place/[placeSlug]/settings/members/_components/`. El page
// lo inyecta a `<MembersList renderRowActions={(m) => <MemberRowActionsMenu
// member={m} ... />} />` — el contrato `renderRowActions` no cambió.
//
// Decisiones no derivables del código:
//   - Self-row sin acciones: defense-in-depth UX sobre `cannot_self_remove`.
//   - Row owner sin acciones: defense-in-depth sobre `target_is_owner` (post
//     ADR-0054 no debería existir un segundo owner; si aparece por datos
//     stale, el menú no ofrece nada sobre él).
//   - Sin trigger cuando items=[]: evita botón "⋯" fantasma.
//   - Remove abre ConfirmDialog (`destructive=true`).
//
// Seam-split canónico: la action inyectada vía `actions` bag (tests
// `vi.fn()`); strings via `labels` (i18n del page).

export interface MemberRowActionsMenuLabels {
  /** Aria label del trigger, template con `{name}`. */
  triggerLabel: string;
  removeLabel: string;
  confirmRemoveTitle: string;
  /** Template con `{name}`. */ confirmRemoveBody: string;
  confirmYes: string;
  confirmNo: string;
  errorUnauthorized: string;
  errorNotOwner: string;
  errorTargetIsOwner: string;
  errorCannotSelfRemove: string;
  errorTargetNotActiveMember: string;
  errorGeneric: string;
}

export type MemberRowActionsMenuCallerContext = {
  userId: string;
  isOwner: boolean;
  isFounder: boolean;
};

export type MemberRowActionsMenuActions = {
  removeAction: typeof removeMemberAction;
};

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
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSelf = member.userId === callerCtx.userId;
  const input = { placeId, targetUserId: member.userId };

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await actions.removeAction(input, placeSlug);
      if (!res.ok) setError(removeErrorLabel(res.error, labels));
    } catch {
      setError(labels.errorGeneric);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const items: ContextMenuItem[] = [];
  if (callerCtx.isOwner && !isSelf && !member.isOwner) {
    items.push({
      key: "remove",
      label: labels.removeLabel,
      onClick: () => setConfirming(true),
      destructive: true,
      disabled: busy,
    });
  }

  if (items.length === 0) {
    return error !== null ? (
      <p role="alert" className="text-xs text-[--accent-strong]">
        {error}
      </p>
    ) : null;
  }

  const confirmBody = labels.confirmRemoveBody.replace(
    "{name}",
    member.displayName,
  );
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
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={handleConfirm}
        title={labels.confirmRemoveTitle}
        description={confirmBody}
        confirmLabel={labels.confirmYes}
        cancelLabel={labels.confirmNo}
        destructive
        busy={busy}
      />
    </div>
  );
}
