"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ArchiveCustomDomain } from "../actions/archive-custom-domain";
import type { CustomDomainRecord } from "../types/custom-domain";
import type { DomainSectionLabels } from "./domain-section";

// Sub-componentes del estado `verified` + flujo de archive del feature
// custom-domain V1 (`docs/features/custom-domain/spec.md` §"UI states").
// Separado del entry-point por límite de LOC (CLAUDE.md §"Límites de
// tamaño": archivo ≤300). Comportamiento idéntico al original.
//
// Decisiones de diseño:
//
// - **`ArchiveTrigger` exportado**: lo consume también `PendingState` desde
//   `./domain-section-pending` (mismo botón "Remover" en pending y verified).
// - **Confirm dialog ESC + `role="dialog"`**: usamos `<div role="dialog">`
//   en vez de `<dialog>` HTML porque jsdom no implementa `showModal()`
//   fiable; el ESC se captura via listener doc-level.
// - **Idempotencia por `useRef`**: bloquea reentradas del archive mientras
//   un submit anterior está en vuelo (mismo patrón que `NoneState`).

const noticeCls =
  "rounded-lg border border-border bg-surface px-4 py-3 text-sm text-ink";
const secondaryCls =
  "inline-flex min-h-[2.75rem] items-center justify-center self-start rounded-lg border border-border bg-surface px-6 text-base font-medium text-ink hover:opacity-80 disabled:opacity-40";

export function VerifiedState(props: {
  record: CustomDomainRecord;
  placeSlug: string;
  archiveAction: ArchiveCustomDomain;
  labels: DomainSectionLabels;
}) {
  const { record, placeSlug, archiveAction, labels } = props;
  return (
    <div className="flex flex-col gap-6">
      <div className={noticeCls}>
        <p className="font-semibold text-ink">{labels.verifiedBadge}</p>
        <p className="mt-1"><strong className="text-ink">{record.domain}</strong></p>
        <p className="mt-1 text-sm text-muted">{labels.verifiedDescription}</p>
      </div>
      <ArchiveTrigger
        placeSlug={placeSlug}
        domainId={record.id}
        archiveAction={archiveAction}
        labels={labels}
      />
    </div>
  );
}

export function ArchiveTrigger(props: {
  placeSlug: string;
  domainId: string;
  archiveAction: ArchiveCustomDomain;
  labels: DomainSectionLabels;
}) {
  const { placeSlug, domainId, archiveAction, labels } = props;
  const [open, setOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const archivingRef = useRef(false);

  async function handleConfirm() {
    if (archivingRef.current) return;
    archivingRef.current = true;
    setArchiving(true);
    setNotice(null);
    try {
      const res = await archiveAction({ placeSlug, domainId });
      if (res.status === "error") {
        setNotice(
          res.reason === "not_found" ? labels.errorArchiveNotFound : labels.errorArchiveGeneric,
        );
        return;
      }
      setOpen(false);
    } catch {
      setNotice(labels.errorArchiveGeneric);
    } finally {
      archivingRef.current = false;
      setArchiving(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={secondaryCls}>
        {labels.archiveButton}
      </button>
      {notice !== null && (
        <p role="status" aria-live="polite" className={noticeCls}>
          {notice}
        </p>
      )}
      {open && (
        <ConfirmDialog
          placeSlug={placeSlug}
          archiving={archiving}
          onCancel={() => setOpen(false)}
          onConfirm={handleConfirm}
          labels={labels}
        />
      )}
    </>
  );
}

function ConfirmDialog(props: {
  placeSlug: string;
  archiving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  labels: DomainSectionLabels;
}) {
  const { placeSlug, archiving, onCancel, onConfirm, labels } = props;
  const titleId = useId();
  const bodyId = useId();
  const body = labels.archiveConfirmBody.replace("{slug}", placeSlug);

  // ESC nativo del browser via listener doc-level. Usamos `<div role="dialog">`
  // en vez de `<dialog>` HTML porque jsdom no implementa `showModal()` fiable.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim px-4"
    >
      <div className="flex max-w-md flex-col gap-4 rounded-lg border border-border bg-surface p-6">
        <h2 id={titleId} className="text-lg font-semibold text-ink">
          {labels.archiveConfirmTitle}
        </h2>
        <p id={bodyId} className="text-sm text-muted">{body}</p>
        <div className="flex flex-row-reverse gap-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={archiving}
            autoFocus
            className="cta inline-flex min-h-[2.5rem] items-center justify-center rounded-lg px-5 text-sm font-medium disabled:opacity-40"
          >
            {archiving ? labels.archiving : labels.archiveConfirmYes}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={archiving}
            className="inline-flex min-h-[2.5rem] items-center justify-center rounded-lg border border-border bg-surface px-5 text-sm font-medium text-ink hover:opacity-80 disabled:opacity-40"
          >
            {labels.archiveConfirmNo}
          </button>
        </div>
      </div>
    </div>
  );
}
