"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/shared/ui/confirm-dialog";

import type {
  RevokeInvitationResult,
  revokeInvitationAction,
} from "../actions/revoke-invitation";
import type { PendingInvitation, RevokeInviteError } from "../types";

// `<PendingInvitationsTab />` — Feature E V1 §S9 (spec.md §"UI screens",
// CU3). Consume `PendingInvitation[]` (loadPendingInvitations, S6) y
// muestra una fila por invitación con CTA revoke. Revoke abre el
// `<ConfirmDialog />` shared (S5) y al confirmar invoca `revokeAction`.
//
// Seam-split canónico: `revokeAction` se inyecta como prop. La revalidación
// post-success es responsabilidad del page RSC (la action ya hace
// `revalidatePath`); este componente NO hace mutación optimista V1 —
// trade-off conservador: el flash de "fila sigue ahí" durante el SSR
// roundtrip es preferible al riesgo de inconsistency-vs-DB en error path.
//
// **Empty state**: render explícito cuando `invitations.length === 0`
// (spec §"UI screens" — sin invitaciones es estado legítimo del owner).
//
// **Caducidad**: el componente recibe el `Date` y renderiza string fijo
// estilo "Expira 1 jun 2026". V1 NO usa `Intl.RelativeTimeFormat` —
// se reservó la decisión para S10 cuando aparezca el spec de copy fino
// (tests.md §S9 menciona "caducidad relativa" pero V1 cierra con format
// fijo `toLocaleDateString` ES-AR para mantener el componente puro y
// determinístico — extensión a relative ⇒ task de polish post-S12).

export interface PendingInvitationsTabLabels {
  emptyTitle: string;
  emptyDescription: string;
  invitedByPrefix: string;
  expiresLabel: string;
  revokeButton: string;
  confirmTitle: string;
  /** Template con `{email}`. */ confirmBody: string;
  confirmYes: string;
  confirmNo: string;
  errorUnauthorized: string;
  errorNotOwner: string;
  errorNotFound: string;
  errorAlreadyAccepted: string;
  errorGeneric: string;
}

const noticeCls =
  "rounded-lg border border-border bg-surface px-4 py-3 text-sm text-ink";
const revokeBtnCls =
  "inline-flex min-h-[2.25rem] items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm text-ink hover:opacity-80 disabled:opacity-40";

function revokeErrorToLabel(
  e: RevokeInviteError,
  l: PendingInvitationsTabLabels,
) {
  const map: Record<RevokeInviteError, string> = {
    unauthorized: l.errorUnauthorized,
    not_owner: l.errorNotOwner,
    not_found: l.errorNotFound,
    already_accepted: l.errorAlreadyAccepted,
    generic: l.errorGeneric,
  };
  return map[e] ?? l.errorGeneric;
}

function formatExpiresAt(d: Date): string {
  return d.toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function PendingInvitationsTab({
  invitations,
  placeSlug,
  revokeAction,
  labels,
}: {
  invitations: PendingInvitation[];
  placeSlug: string;
  revokeAction: typeof revokeInvitationAction;
  labels: PendingInvitationsTabLabels;
}) {
  const [confirming, setConfirming] = useState<PendingInvitation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!confirming) return;
    setBusy(true);
    setError(null);
    try {
      const res: RevokeInvitationResult = await revokeAction(
        { invitationId: confirming.invitationId },
        placeSlug,
      );
      if (res.ok) {
        setConfirming(null);
      } else {
        setError(revokeErrorToLabel(res.error, labels));
        setConfirming(null);
      }
    } catch {
      setError(labels.errorGeneric);
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  if (invitations.length === 0) {
    return (
      <section className="flex flex-col gap-2 px-4 py-6 md:px-8">
        <h3 className="text-base font-medium text-ink">{labels.emptyTitle}</h3>
        <p className="text-sm text-muted">{labels.emptyDescription}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 px-4 py-6 md:px-8">
      {error !== null && (
        <p role="alert" className={noticeCls}>
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {invitations.map((inv) => (
          <li
            key={inv.invitationId}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3"
          >
            <div className="flex flex-col gap-1">
              <span className="text-sm text-ink">{inv.email}</span>
              <span className="text-xs text-muted">
                {labels.invitedByPrefix} {inv.invitedByDisplayName} ·{" "}
                {labels.expiresLabel} {formatExpiresAt(inv.expiresAt)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setConfirming(inv)}
              className={revokeBtnCls}
              disabled={busy}
            >
              {labels.revokeButton}
            </button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={handleConfirm}
        title={labels.confirmTitle}
        description={
          confirming
            ? labels.confirmBody.replace("{email}", confirming.email)
            : ""
        }
        confirmLabel={labels.confirmYes}
        cancelLabel={labels.confirmNo}
        destructive
        busy={busy}
      />
    </section>
  );
}
