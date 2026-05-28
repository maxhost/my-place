"use client";

import { type FormEvent, useId, useRef, useState } from "react";

import type {
  CreateInvitationResult,
  createInvitationAction,
} from "../actions/create-invitation";
import type { InviteError } from "../types";

// `<InviteMemberModal />` — Feature E V1 §S9 (spec.md §"UI screens", CU2).
// Modal de creación de invitación capability-based. Flujo:
//   1) Form: email + expiresInDays (default 7) + submit.
//   2) Submit ⇒ invoca `createAction(input, placeSlug)` (Server Action S7).
//   3) Success ⇒ revela link `${inviteBaseUrl}/invite/<token>` + CTA copy.
//   4) Copy ⇒ `navigator.clipboard.writeText` + status efímero "¡Copiado!".
//
// Seam-split canónico (mismo paradigma que `<DomainSection>`): `createAction`
// se inyecta como prop. Tests RTL pasan `vi.fn()`; el page S11 inyecta
// `createInvitationAction` real. El componente NO importa la Server Action
// directamente — sólo el tipo. Eso permite tests RTL puros (jsdom) sin
// montar el stack next/headers + Neon Auth + DB.
//
// **Capability-based copy explícito** (spec §CU2 + ADR-0010 §2): la
// descripción del modal advierte que cualquiera con el link puede unirse
// — esa es la naturaleza de la capability y la UI lo hace transparente.
//
// **i18n**: strings ES hardcoded via `labels` prop. Extracción a `i18n/`
// + dispatch desde el page RSC sucede en S11 (plan-sesiones §S11).
//
// **Sin toast lib**: el feedback success/error es `<p role="status">`
// inline (mismo patrón que `<DomainSection>` copy tooltip). No agregamos
// dependencia nueva V1.
//
// **`expiresInDays` default = 7**: balance entre "tiempo suficiente para
// que el invitado actúe" y "no dejar capabilities vivas indefinidamente".
// Rango legal [1, 90] (zod schema S7 + DEFINER P0001 'expires_at must be
// in the future').

export interface InviteMemberModalLabels {
  title: string;
  description: string;
  emailLabel: string;
  emailPlaceholder: string;
  expiresLabel: string;
  submitButton: string;
  submitting: string;
  successHeading: string;
  copyButton: string;
  copiedTooltip: string;
  closeButton: string;
  errorInvalidEmail: string;
  errorInvalidExpires: string;
  errorUnauthorized: string;
  errorNotOwner: string;
  errorExpiresInPast: string;
  /** Phase 0.D — rate limit excedido (30/h por place). */
  errorRateLimited: string;
  errorGeneric: string;
}

const inputCls =
  "min-h-[2.75rem] rounded-lg border border-border bg-surface px-3 text-base text-ink disabled:opacity-60";
const ctaCls =
  "cta inline-flex min-h-[2.75rem] items-center justify-center self-start rounded-lg px-6 text-base font-medium disabled:opacity-40";
const ctaSecondaryCls =
  "inline-flex min-h-[2.5rem] items-center justify-center rounded-lg border border-border bg-surface px-5 text-sm font-medium text-ink hover:opacity-80 disabled:opacity-40";
const noticeCls =
  "rounded-lg border border-border bg-surface px-4 py-3 text-sm text-ink";

const COPIED_MS = 1800;
const DEFAULT_EXPIRES_DAYS = 7;
const MIN_EXPIRES_DAYS = 1;
const MAX_EXPIRES_DAYS = 90;

function inviteErrorToLabel(e: InviteError, l: InviteMemberModalLabels) {
  const map: Record<InviteError, string> = {
    unauthorized: l.errorUnauthorized,
    not_owner: l.errorNotOwner,
    invalid_email: l.errorInvalidEmail,
    invalid_expires: l.errorInvalidExpires,
    expires_in_past: l.errorExpiresInPast,
    rate_limited: l.errorRateLimited,
    generic: l.errorGeneric,
  };
  return map[e] ?? l.errorGeneric;
}

// Mismo regex que zod usa app-side (`z.email()`). Validamos client-side
// para no llamar al server con basura — la action igual revalida por
// defense-in-depth (S7 schema), pero ahorramos un roundtrip.
const EMAIL_RE =
  /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export function InviteMemberModal({
  placeId,
  placeSlug,
  inviteBaseUrl,
  createAction,
  onClose,
  labels,
}: {
  placeId: string;
  placeSlug: string;
  /** Base URL sin trailing slash. El componente templea `${base}/invite/<token>`. */
  inviteBaseUrl: string;
  createAction: typeof createInvitationAction;
  onClose: () => void;
  labels: InviteMemberModalLabels;
}) {
  const [email, setEmail] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(DEFAULT_EXPIRES_DAYS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ link: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const submittingRef = useRef(false);

  const titleId = useId();
  const bodyId = useId();
  const emailId = useId();
  const expiresId = useId();
  const errorId = useId();

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;
    if (!EMAIL_RE.test(email)) {
      setError(labels.errorInvalidEmail);
      return;
    }
    if (
      !Number.isInteger(expiresInDays) ||
      expiresInDays < MIN_EXPIRES_DAYS ||
      expiresInDays > MAX_EXPIRES_DAYS
    ) {
      setError(labels.errorInvalidExpires);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const res: CreateInvitationResult = await createAction(
        { placeId, email, expiresInDays },
        placeSlug,
      );
      if (res.ok) {
        setSuccess({ link: `${inviteBaseUrl}/invite/${res.token}` });
      } else {
        setError(inviteErrorToLabel(res.error, labels));
      }
    } catch {
      setError(labels.errorGeneric);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!success) return;
    try {
      await navigator.clipboard?.writeText(success.link);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // Fallback silencioso: triple-click + Cmd/Ctrl+C manual.
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
    >
      <div className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-border bg-surface p-6">
        <h2 id={titleId} className="text-lg font-semibold text-ink">
          {labels.title}
        </h2>
        <p id={bodyId} className="text-sm text-muted">
          {labels.description}
        </p>
        {success === null ? (
          <form
            onSubmit={handleSubmit}
            noValidate
            className="flex flex-col gap-4"
            aria-busy={submitting || undefined}
          >
            <div className="flex flex-col gap-2">
              <label htmlFor={emailId} className="text-sm font-medium text-ink">
                {labels.emailLabel}
              </label>
              <input
                id={emailId}
                type="email"
                value={email}
                placeholder={labels.emailPlaceholder}
                disabled={submitting}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error !== null) setError(null);
                }}
                aria-describedby={error !== null ? errorId : undefined}
                className={inputCls}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label
                htmlFor={expiresId}
                className="text-sm font-medium text-ink"
              >
                {labels.expiresLabel}
              </label>
              <input
                id={expiresId}
                type="number"
                value={expiresInDays}
                min={MIN_EXPIRES_DAYS}
                max={MAX_EXPIRES_DAYS}
                step={1}
                disabled={submitting}
                onChange={(e) => {
                  setExpiresInDays(Number.parseInt(e.target.value, 10));
                  if (error !== null) setError(null);
                }}
                className={inputCls}
              />
            </div>
            {error !== null && (
              <p id={errorId} role="alert" className={noticeCls}>
                {error}
              </p>
            )}
            <div className="flex flex-row-reverse gap-3">
              <button type="submit" disabled={submitting} className={ctaCls}>
                {submitting ? labels.submitting : labels.submitButton}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className={ctaSecondaryCls}
              >
                {labels.closeButton}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-ink">
              {labels.successHeading}
            </p>
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-3 py-2">
              <span style={{ userSelect: "all" }} className="break-all text-sm text-ink">
                {success.link}
              </span>
            </div>
            <div className="flex flex-row-reverse items-center gap-3">
              <button type="button" onClick={onClose} className={ctaSecondaryCls}>
                {labels.closeButton}
              </button>
              <button type="button" onClick={handleCopy} className={ctaCls}>
                {labels.copyButton}
              </button>
              {copied && (
                <span role="status" aria-live="polite" className="text-xs text-muted">
                  {labels.copiedTooltip}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
