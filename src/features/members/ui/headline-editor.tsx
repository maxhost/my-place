"use client";

import { type FormEvent, useId, useState } from "react";

import type {
  UpdateMyHeadlineResult,
  updateMyHeadlineAction,
} from "../actions/update-my-headline";
import type { HeadlineError } from "../types";

// `<HeadlineEditor />` — Feature E V1 §S10 (spec.md §CU1, ADR-0036).
// Editor inline self-only del headline contextual del miembro en este place.
// El page S11 lo monta en el perfil contextual del miembro (no en
// /settings/members) — V1 vive donde el usuario tappea su propio avatar
// (decisión spec §"UI screens" S10).
//
// **Branch crítico ADR-0036 §1**: `currentHeadline == null && !isMe`
// ⇒ retorna `null` (sin placeholder pasivo "Sin headline" — los miembros
// sin bio no muestran nada). `isMe == true` con headline null ⇒ CTA
// "Agregar headline" para que el propio miembro pueda sumar una bio.
//
// **Self-edit only** (ADR-0036 §3 + decisión spec §"Decisión operativa"):
// el componente asume que el caller ES el target. La DEFINER
// `app.update_my_headline` NO acepta `targetUserId` — siempre escribe
// sobre el caller. El page S11 sólo monta este editor cuando
// `member.userId === callerCtx.userId`.
//
// **Local state post-success**: `displayed` se actualiza optimisticamente
// tras success — evita parpadeo mientras `revalidatePath` se propaga
// (defense + UX immediate). Si el server revalida con otro valor (no
// debería V1, action es passthrough), el siguiente render con el nuevo
// `currentHeadline` prop alinearía.
//
// **Empty string ⇒ NULL**: input vacío al guardar ⇒ enviamos `null` a la
// action (clear semantic). El schema zod acepta string vacío como válido,
// pero UX: "borré el texto" === "borré la bio". Decisión consciente V1.
//
// **Counter `len/280`**: hardcoded el techo 280 (CHECK constraint DB +
// zod). Si V2+ cambia el techo, actualizar acá + zod + CHECK.
//
// **Seam-split**: `updateAction` inyectada. Tests `vi.fn()`; page S11 inyecta
// `updateMyHeadlineAction` real.

const MAX_HEADLINE_LEN = 280;

export interface HeadlineEditorLabels {
  viewEditButton: string;
  emptyCta: string;
  inputLabel: string;
  inputPlaceholder: string;
  saveButton: string;
  cancelButton: string;
  saving: string;
  /** Template con `{count}` (longitud actual). */
  counterTemplate: string;
  errorTooLong: string;
  errorUnauthorized: string;
  errorNotMember: string;
  errorGeneric: string;
}

function headlineErrorLabel(
  e: HeadlineError,
  l: HeadlineEditorLabels,
): string {
  const map: Record<HeadlineError, string> = {
    unauthorized: l.errorUnauthorized,
    not_member: l.errorNotMember,
    too_long: l.errorTooLong,
    generic: l.errorGeneric,
  };
  return map[e] ?? l.errorGeneric;
}

export function HeadlineEditor({
  placeId,
  placeSlug,
  currentHeadline,
  isMe,
  updateAction,
  labels,
}: {
  placeId: string;
  placeSlug: string;
  currentHeadline: string | null;
  isMe: boolean;
  updateAction: typeof updateMyHeadlineAction;
  labels: HeadlineEditorLabels;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [displayed, setDisplayed] = useState<string | null>(currentHeadline);
  const [draft, setDraft] = useState<string>(currentHeadline ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputId = useId();
  const counterId = useId();
  const errorId = useId();

  if (displayed === null && !isMe) return null;

  function openEdit() {
    setDraft(displayed ?? "");
    setError(null);
    setMode("edit");
  }

  function cancelEdit() {
    setMode("view");
    setError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (draft.length > MAX_HEADLINE_LEN) {
      setError(labels.errorTooLong);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = draft === "" ? null : draft;
      const res: UpdateMyHeadlineResult = await updateAction(
        { placeId, headline: payload },
        placeSlug,
      );
      if (res.ok) {
        setDisplayed(payload);
        setMode("view");
      } else {
        setError(headlineErrorLabel(res.error, labels));
      }
    } catch {
      setError(labels.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  if (mode === "edit") {
    const counter = labels.counterTemplate.replace(
      "{count}",
      String(draft.length),
    );
    const overLimit = draft.length > MAX_HEADLINE_LEN;
    return (
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2"
        aria-busy={busy || undefined}
      >
        <label htmlFor={inputId} className="text-sm font-medium text-ink">
          {labels.inputLabel}
        </label>
        <textarea
          id={inputId}
          value={draft}
          placeholder={labels.inputPlaceholder}
          disabled={busy}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error !== null) setError(null);
          }}
          aria-describedby={`${counterId}${error !== null ? ` ${errorId}` : ""}`}
          maxLength={MAX_HEADLINE_LEN + 50}
          rows={3}
          className="min-h-[5rem] rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-2">
          <span
            id={counterId}
            className={`text-xs ${overLimit ? "text-[--accent-strong]" : "text-muted"}`}
          >
            {counter}
          </span>
        </div>
        {error !== null && (
          <p
            id={errorId}
            role="alert"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
          >
            {error}
          </p>
        )}
        <div className="flex flex-row-reverse gap-3">
          <button
            type="submit"
            disabled={busy || overLimit}
            className="cta inline-flex min-h-[2.5rem] items-center justify-center rounded-lg px-5 text-sm font-medium disabled:opacity-40"
          >
            {busy ? labels.saving : labels.saveButton}
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            disabled={busy}
            className="inline-flex min-h-[2.5rem] items-center justify-center rounded-lg border border-border bg-surface px-5 text-sm font-medium text-ink hover:opacity-80 disabled:opacity-40"
          >
            {labels.cancelButton}
          </button>
        </div>
      </form>
    );
  }

  if (displayed === null) {
    return (
      <button
        type="button"
        onClick={openEdit}
        className="inline-flex min-h-[2.5rem] items-center justify-start rounded-lg border border-border bg-surface px-3 text-sm font-medium text-muted hover:opacity-80"
      >
        {labels.emptyCta}
      </button>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <p className="text-sm text-ink">{displayed}</p>
      {isMe && (
        <button
          type="button"
          onClick={openEdit}
          className="inline-flex min-h-[2rem] items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-ink hover:opacity-80"
        >
          {labels.viewEditButton}
        </button>
      )}
    </div>
  );
}
