"use client";

import { useState } from "react";

import type {
  AcceptInvitationError,
  AcceptInvitationInput,
  AcceptInvitationResult,
} from "@/features/invitations/public";

// V1.1 S3 — `<InviteAcceptancePanel />`: Client co-located bajo
// `(app)/place/[placeSlug]/invite/[token]/_components/`. Renderiza las 3
// variantes de la spec (CU-Accept-1/2/3) + maneja el submit a
// `acceptInvitationAction` con state machine `idle | accepting | error`. El
// success path navega a `placeHomeUrl` y no hace `setState` (la pantalla se
// reemplaza por la del hub del place tras la navegación).
//
// ## Por qué Client + page-level (no slice)
//
// Patrón paralelo a `<MembersPageShell />` (ADR-0043): co-located bajo
// `_components/` porque (a) consume sólo capabilities del slice
// `invitations/` (via `public.ts`) sin agregar dominio propio, (b) la state
// machine y el wiring del navigate son UI-only sin reuso fuera de esta page,
// (c) la spec del slice no introduce este shell como capability propia. Si
// V1.2+ ramifica la lógica (multi-account switcher, etc.), evaluar promover
// a slice nuevo o a sub-folder dentro del slice consumidor.
//
// ## State machine
//
// - `idle`: render inicial. Las 3 variantes deciden qué subtree mostrar.
// - `accepting`: in-flight tras click "Aceptar"; CTA en loading state.
// - `error(<kind>)`: la action retornó error mapeado al kind. Render del
//   panel de error con copy del labels.
//
// Success NO es un estado React: cuando la action retorna `{status:
// 'success'}`, el componente invoca `navigate(placeHomeUrl)` y el browser
// salta al hub del place — el componente se desmonta. Defensivamente
// mantiene `accepting` hasta el unmount para que un re-click no dispare la
// action 2x mientras la navegación está en curso.
//
// ## Tampering check pre-action
//
// El email match se hace pre-action en el RSC (page), pero también acá como
// defense-in-depth: si por alguna razón `currentUserEmail` no coincide con
// `inviteeEmail`, mostramos el panel mismatch en vez de llamar la action.
// El DEFINER tiene su propio gate (P0008), pero evitamos el round-trip.
//
// Match es case-insensitive + btrim() — paridad exacta con el comparator
// del DEFINER (`lower(btrim(v_email)) <> lower(btrim(v_inv_email))`,
// migration 0003:88).
//
// ## Logout + redirect a login (mismatch CTA)
//
// `onLogout` es una Server Action (típicamente `logoutAction.bind(null,
// locale)` del slice `nav-hub/`) que invoca `getAuth().signOut()` y retorna
// la URL post-logout. Nosotros ignoramos ese retorno: el panel quiere
// re-dirigir a `loginUrl` (con returnTo prefilled), no al landing apex que
// `logoutAction` retorna por default. Por eso navegamos a `loginUrl`
// explícitamente post-logout. Si el signOut SDK falla (red, transport), el
// catch absorbe y navegamos igual (best-effort, paralelo a `logoutAction`
// catch interno).
//
// ## Interpolación de labels
//
// Strings con `{var}` se reemplazan vía `replaceAll`. Es i18n placeholder
// pre-S4; cuando S4 introduzca `placeInvitation` namespace, la page pasa
// strings ya formateados via `getTranslations(...)({var})` y el panel
// mantiene la misma API.

export interface InviteAcceptancePanelLabels {
  /** "Invitación a {placeName}". */
  header: string;
  /** "Esta invitación es para {email}". */
  previewEmail: string;
  /** "Aceptar invitación a {placeName}". */
  acceptButton: string;
  /** "No, gracias" — link al Hub canónico. */
  declineLink: string;
  /** "Iniciar sesión" — CTA visitor anónimo. */
  ctaLogin: string;
  /** "Crear cuenta" — CTA visitor anónimo. */
  ctaSignup: string;
  /** Título panel mismatch (CU-Accept-3). */
  emailMismatchTitle: string;
  /** "Esta invitación es para {invEmail}. Estás logueado como {currentEmail}." */
  emailMismatchBody: string;
  /** "Cerrar sesión y entrar como {invEmail}". */
  emailMismatchLogoutCta: string;
  /** Mensajes de error mapeados desde `AcceptInvitationError`. */
  errorExpired: string;
  errorAlreadyUsed: string;
  errorPlaceFull: string;
  /** Phase 0.D — rate limit. `{seconds}` interpolado client-side. */
  errorRateLimited: string;
  errorUnknown: string;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, value),
    template,
  );
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

type PanelState =
  | { status: "idle" }
  | { status: "accepting" }
  | { status: "success" }
  | { status: "error"; error: AcceptInvitationError };

function errorCopy(
  error: AcceptInvitationError,
  labels: InviteAcceptancePanelLabels,
): string {
  switch (error.kind) {
    case "expired":
      return labels.errorExpired;
    case "already_used":
      return labels.errorAlreadyUsed;
    case "place_full":
      return labels.errorPlaceFull;
    case "rate_limited":
      return labels.errorRateLimited.replaceAll(
        "{seconds}",
        String(error.retryAfterSeconds),
      );
    default:
      // unauthenticated / app_user_missing / not_found / email_mismatch /
      // unknown — copy genérico anti-info-leak. Los casos esperados los
      // resuelve la UI pre-action (mismatch panel + redirect login).
      return labels.errorUnknown;
  }
}

function defaultNavigate(url: string) {
  window.location.assign(url);
}

const panelCls = "mx-auto flex w-full max-w-[28rem] flex-col gap-6 px-6 py-12";
const headerCls = "flex flex-col gap-2";
const titleCls = "text-3xl text-ink";
const subtitleCls = "text-sm text-muted";
const ctaPrimaryCls =
  "cta inline-flex min-h-[2.75rem] items-center justify-center rounded-lg px-5 text-base font-medium";
const ctaSecondaryCls =
  "inline-flex min-h-[2.75rem] items-center justify-center rounded-lg border border-border px-5 text-sm font-medium text-ink";
const ctaLinkCls = "text-sm text-muted underline-offset-2 hover:underline";
const errorPanelCls =
  "rounded-lg border border-accent-strong/30 bg-accent-strong/5 p-4 text-sm text-accent-strong";

export function InviteAcceptancePanel({
  token,
  placeSlug,
  placeName,
  inviteeEmail,
  currentUserEmail,
  loginUrl,
  signupUrl,
  hubUrl,
  placeHomeUrl,
  acceptInvitationAction,
  onLogout,
  navigate = defaultNavigate,
  labels,
}: {
  token: string;
  placeSlug: string;
  placeName: string;
  inviteeEmail: string;
  currentUserEmail: string | null;
  loginUrl: string;
  signupUrl: string;
  hubUrl: string;
  placeHomeUrl: string;
  acceptInvitationAction: (
    input: AcceptInvitationInput,
  ) => Promise<AcceptInvitationResult>;
  /** Server Action signOut (típicamente `logoutAction.bind(null, locale)`). */
  onLogout: () => Promise<unknown>;
  /** Inyectable para tests; default = `window.location.assign`. */
  navigate?: (url: string) => void;
  labels: InviteAcceptancePanelLabels;
}) {
  const [state, setState] = useState<PanelState>({ status: "idle" });

  const variant: "unauth" | "match" | "mismatch" = (() => {
    if (currentUserEmail === null) return "unauth";
    return normalizeEmail(currentUserEmail) === normalizeEmail(inviteeEmail)
      ? "match"
      : "mismatch";
  })();

  const header = interpolate(labels.header, { placeName });
  const preview = interpolate(labels.previewEmail, { email: inviteeEmail });
  const acceptLabel = interpolate(labels.acceptButton, { placeName });
  const mismatchBody = interpolate(labels.emailMismatchBody, {
    invEmail: inviteeEmail,
    currentEmail: currentUserEmail ?? "",
  });
  const mismatchCta = interpolate(labels.emailMismatchLogoutCta, {
    invEmail: inviteeEmail,
  });

  async function handleAccept() {
    if (state.status === "accepting" || state.status === "success") return;
    setState({ status: "accepting" });
    const result = await acceptInvitationAction({ token, placeSlug });
    if (result.status === "success") {
      setState({ status: "success" });
      navigate(placeHomeUrl);
      return;
    }
    setState({ status: "error", error: result.error });
  }

  async function handleLogoutAndLogin() {
    try {
      await onLogout();
    } catch {
      // Best-effort: si el SDK signOut falla, igual redirigimos al login —
      // la cookie cross-subdomain puede sobrevivir un instante, pero el
      // flow de login del apex revalida o re-pide credenciales (paralelo
      // al catch interno de `logoutAction`).
    }
    navigate(loginUrl);
  }

  return (
    <section className={panelCls} aria-labelledby="invite-header">
      <header className={headerCls}>
        <h1 id="invite-header" className={titleCls}>
          {header}
        </h1>
        <p className={subtitleCls}>{preview}</p>
      </header>

      {variant === "unauth" && (
        <div className="flex flex-col gap-3">
          <a href={loginUrl} className={ctaPrimaryCls}>
            {labels.ctaLogin}
          </a>
          <a href={signupUrl} className={ctaSecondaryCls}>
            {labels.ctaSignup}
          </a>
        </div>
      )}

      {variant === "mismatch" && (
        <div className={errorPanelCls} role="alert">
          <h2 className="text-base font-medium text-ink">
            {labels.emailMismatchTitle}
          </h2>
          <p className="mt-2 text-sm text-muted">{mismatchBody}</p>
          <button
            type="button"
            onClick={handleLogoutAndLogin}
            className={`${ctaSecondaryCls} mt-4`}
          >
            {mismatchCta}
          </button>
        </div>
      )}

      {variant === "match" && state.status !== "error" && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={handleAccept}
            disabled={
              state.status === "accepting" || state.status === "success"
            }
            className={ctaPrimaryCls}
          >
            {acceptLabel}
          </button>
          <a href={hubUrl} className={ctaLinkCls}>
            {labels.declineLink}
          </a>
        </div>
      )}

      {state.status === "error" && (
        <div className={errorPanelCls} role="alert">
          <p>{errorCopy(state.error, labels)}</p>
        </div>
      )}
    </section>
  );
}
