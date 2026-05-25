"use client";

import { useEffect, useId } from "react";

// ConfirmDialog genérico shared/ui (S5 Feature E). Semántica extraída del
// inline de `features/custom-domain/ui/domain-section-archive.tsx:109-165`:
// overlay full-screen + diálogo centrado + ESC cierra + autoFocus en confirm.
// Usamos `<div role="dialog">` (no `<dialog>` HTML) porque jsdom no
// implementa `showModal()` confiable — mismo trade-off del precedente.
//
// `destructive` mapea a `--accent-strong` (terracota oscuro ya definido en
// globals.css). No agregamos token `--danger` nuevo: extender el DS para un
// destructive dedicado se decide cuando aparezca el primer flujo donde
// `accent-strong` se sienta insuficiente. La clase semántica
// `cta-destructive` queda como handle estable para tests y para una futura
// promoción a token propio sin tocar consumers.

export type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  busy?: boolean;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  busy = false,
}: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const confirmBaseClass =
    "inline-flex min-h-[2.5rem] items-center justify-center rounded-lg px-5 text-sm font-medium disabled:opacity-40";
  // `bg-[--accent-strong]` mapea al token canónico del DS (globals.css l.23).
  // `cta-destructive` queda como handle semántico estable para tests y futura
  // promoción a token propio.
  const confirmClass = destructive
    ? `${confirmBaseClass} cta-destructive bg-[--accent-strong] text-accent-ink`
    : `${confirmBaseClass} cta`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
    >
      <div className="flex max-w-md flex-col gap-4 rounded-lg border border-border bg-surface p-6">
        <h2 id={titleId} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        <p id={bodyId} className="text-sm text-muted">
          {description}
        </p>
        <div className="flex flex-row-reverse gap-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className={confirmClass}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex min-h-[2.5rem] items-center justify-center rounded-lg border border-border bg-surface px-5 text-sm font-medium text-ink hover:opacity-80 disabled:opacity-40"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
