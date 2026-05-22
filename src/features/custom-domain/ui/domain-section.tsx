"use client";

import {
  type FormEvent,
  useId,
  useRef,
  useState,
} from "react";
import {
  type ValidationReason,
  validateCustomDomain,
} from "@/shared/lib/custom-domain";
import type { ArchiveCustomDomain } from "../actions/archive-custom-domain";
import type { RegisterCustomDomain } from "../actions/register-custom-domain";
import type {
  CustomDomainState,
  RegisterError,
} from "../types/custom-domain";
import { VerifiedState } from "./domain-section-archive";
import { PendingState } from "./domain-section-pending";

// Sección "Dominio" del settings (S4 feature custom-domain V1,
// `docs/features/custom-domain/spec.md` §"UI states"). Client Component:
// 3 estados (`none` / `pending` / `verified`) + form de registro + tabla
// DNS con copy-to-clipboard + confirm dialog de archive + auto-refresh
// (`router.refresh()` cada 30s) mientras está pending.
//
// Decisiones de diseño globales del slice (los sub-componentes hermanos
// `./domain-section-pending` y `./domain-section-archive` documentan los
// detalles específicos de cada estado):
//
// - **Labels inline** (vs archivo aparte): igual que `LocaleSection`. El
//   slice cabe bajo el límite con sub-componentes locales.
// - **`registerAction`/`archiveAction` como props** (seam-split canónico):
//   los tests inyectan `vi.fn()`; el page S4 inyecta las Server Actions.
// - **`onRefresh` opcional**: default = `useRouter().refresh()` cada 30s.
//   Dos sub-componentes elegidos por mount → rules of hooks intacto, y
//   `useRouter` SÓLO se llama cuando no hay inyección (en jsdom no hay
//   App Router montado). Detalle en `./domain-section-pending`.
// - **Idempotencia por `useRef`**: bloquea reentradas mientras un submit
//   anterior está en vuelo (mismo patrón que `LocaleSection`).
// - **`navigator.clipboard` fallback elegante** (spec §"Decisión:
//   navigator.clipboard requiere secure context"): si la API no existe o
//   falla, silenciamos sin toast; el valor sigue seleccionable manualmente.
// - **Placeholders**: `{domain}` en `pendingDescription`, `{slug}` en
//   `archiveConfirmBody` — misma convención que `wizard.successBody`/`{url}`.
// - **Split por LOC** (CLAUDE.md §"Límites de tamaño"): el slice se divide
//   en 3 archivos hermanos. Este es el entry-point: expone `DomainSection`
//   + `DomainSectionLabels` y hace dispatch a los sub-componentes. Los
//   hermanos importan `DomainSectionLabels` con `import type` — ciclo
//   sólo en types, TS lo resuelve sin runtime issues.

export interface DomainSectionLabels {
  title: string;
  description: string;
  inputLabel: string;
  inputPlaceholder: string;
  submitButton: string;
  submitting: string;
  pendingTitle: string;
  /** Template con `{domain}`. */ pendingDescription: string;
  /** Banner ADR-0029 §UX downreverted: dominio que estaba verified
   * y se rompió en DNS. Sólo se renderiza si `state.wasDownreverted`. */
  downrevertedBannerTitle: string;
  /** Template con `{domain}`. Body del banner downreverted. */
  downrevertedBannerBody: string;
  pendingSlaCopy: string;
  /** Reemplaza la tabla DNS cuando Vercel no respondió. */ pendingVercelUnavailable: string;
  dnsRecordsTitle: string;
  dnsRecordType: string;
  dnsRecordName: string;
  dnsRecordValue: string;
  copyButton: string;
  copiedTooltip: string;
  verifiedBadge: string;
  verifiedDescription: string;
  archiveButton: string;
  archiveConfirmTitle: string;
  /** Template con `{slug}`. */ archiveConfirmBody: string;
  archiveConfirmYes: string;
  archiveConfirmNo: string;
  archiving: string;
  errorInvalidDomain: string;
  errorReserved: string;
  errorIdnNotSupported: string;
  errorDomainTaken: string;
  errorLimitReached: string;
  errorVercelUnavailable: string;
  errorGeneric: string;
  errorArchiveNotFound: string;
  errorArchiveGeneric: string;
}

const inputCls =
  "min-h-[2.75rem] rounded-lg border border-border bg-surface px-3 text-base text-ink disabled:opacity-60";
const noticeCls =
  "rounded-lg border border-border bg-surface px-4 py-3 text-sm text-ink";
const ctaCls =
  "cta inline-flex min-h-[2.75rem] items-center justify-center self-start rounded-lg px-6 text-base font-medium disabled:opacity-40";

function validationReasonToLabel(r: ValidationReason, l: DomainSectionLabels) {
  if (r === "idn_not_supported") return l.errorIdnNotSupported;
  if (r === "reserved") return l.errorReserved;
  return l.errorInvalidDomain;
}

function registerErrorToLabel(r: RegisterError, l: DomainSectionLabels) {
  const map: Record<RegisterError, string> = {
    invalid_domain: l.errorInvalidDomain,
    reserved: l.errorReserved,
    idn_not_supported: l.errorIdnNotSupported,
    domain_taken: l.errorDomainTaken,
    limit_reached: l.errorLimitReached,
    vercel_unavailable: l.errorVercelUnavailable,
    generic: l.errorGeneric,
  };
  return map[r] ?? l.errorGeneric;
}

export function DomainSection({
  state,
  placeSlug,
  registerAction,
  archiveAction,
  labels,
  onRefresh,
}: {
  state: CustomDomainState;
  placeSlug: string;
  registerAction: RegisterCustomDomain;
  archiveAction: ArchiveCustomDomain;
  labels: DomainSectionLabels;
  /** Default: `useRouter().refresh()`. Inyectable para tests UI. */
  onRefresh?: () => void;
}) {
  return (
    <section className="flex flex-1 flex-col gap-6 px-4 py-6 md:px-8 md:py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl text-ink">{labels.title}</h1>
        <p className="max-w-prose leading-relaxed text-muted">{labels.description}</p>
      </header>
      {state.status === "none" && (
        <NoneState placeSlug={placeSlug} registerAction={registerAction} labels={labels} />
      )}
      {state.status === "pending" && (
        <PendingState
          state={state}
          placeSlug={placeSlug}
          archiveAction={archiveAction}
          labels={labels}
          onRefresh={onRefresh}
        />
      )}
      {state.status === "verified" && (
        <VerifiedState
          record={state.record}
          placeSlug={placeSlug}
          archiveAction={archiveAction}
          labels={labels}
        />
      )}
    </section>
  );
}

function NoneState(props: {
  placeSlug: string;
  registerAction: RegisterCustomDomain;
  labels: DomainSectionLabels;
}) {
  const { placeSlug, registerAction, labels } = props;
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const canSubmit = value.trim().length > 0 && !submitting;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current || !canSubmit) return;
    // Validación cliente espeja al Server (SoT compartido).
    const v = validateCustomDomain(value);
    if (!v.ok) return setNotice(validationReasonToLabel(v.reason, labels));
    submittingRef.current = true;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await registerAction({ placeSlug, domain: v.normalized });
      if (res.status === "error") setNotice(registerErrorToLabel(res.reason, labels));
      // ok → Server hizo `revalidatePath`; el state cambia vía SSR.
    } catch {
      setNotice(labels.errorGeneric);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <NoneForm
      value={value}
      submitting={submitting}
      notice={notice}
      canSubmit={canSubmit}
      labels={labels}
      onChange={(v) => {
        setValue(v);
        if (notice !== null) setNotice(null);
      }}
      onSubmit={handleSubmit}
    />
  );
}

function NoneForm(props: {
  value: string;
  submitting: boolean;
  notice: string | null;
  canSubmit: boolean;
  labels: DomainSectionLabels;
  onChange: (v: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const { value, submitting, notice, canSubmit, labels, onChange, onSubmit } = props;
  const inputId = useId();
  const noticeId = useId();
  return (
    <form
      onSubmit={onSubmit}
      className="flex max-w-md flex-col gap-4"
      aria-busy={submitting || undefined}
    >
      <div className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm font-medium text-ink">
          {labels.inputLabel}
        </label>
        <input
          id={inputId}
          type="text"
          value={value}
          placeholder={labels.inputPlaceholder}
          disabled={submitting}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={notice !== null ? noticeId : undefined}
          className={inputCls}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <button type="submit" disabled={!canSubmit} className={ctaCls}>
        {submitting ? labels.submitting : labels.submitButton}
      </button>
      {notice !== null && (
        <p id={noticeId} role="status" aria-live="polite" className={noticeCls}>
          {notice}
        </p>
      )}
    </form>
  );
}
