"use client";

import {
  PlaceWizard,
  type WizardLabels,
  type WizardSubmit,
} from "@/features/place-wizard/public";
import type { AccessLabels, AccessSubmit } from "./access-labels";
import { useAccessForm } from "./use-access-form";

// Vía "Acceso" (S9, ADR-0008/0009): form account-first (login | signup) →
// elección post-auth → wizard reutilizado en modo authed. Componente CLIENTE;
// la máquina vive en `useAccessForm`. Textos por prop `labels` (serializable,
// sin runtime i18n — mismo ethos que el wizard, S8a) y el borde cross-system
// por prop `auth`/`onCreatePlace` (seam-split: la ruta cablea los Server
// Actions vivos, los tests inyectan fakes — el SDK Neon Auth no es
// vitest-testeable). `producto.md` cozytech: nada alarma, avisos calmos.

const fieldClass =
  "min-h-[2.75rem] rounded-lg border border-border bg-surface px-3 text-base text-ink";
const errClass = "text-sm text-accent-strong";

export function AccessFlow({
  labels,
  wizardLabels,
  auth,
  onCreatePlace,
  rootDomain,
  termsHref,
  privacyHref,
  homeHref,
}: {
  labels: AccessLabels;
  wizardLabels: WizardLabels;
  auth: AccessSubmit;
  onCreatePlace: WizardSubmit;
  rootDomain: string;
  termsHref: string;
  privacyHref: string;
  homeHref: string;
}) {
  const a = useAccessForm({ labels, auth });
  const l = labels;

  // Modo authed: la saga reutiliza el wizard SIN el paso de cuenta (ADR-0008
  // §3) — el usuario ya está autenticado, no se re-pide cuenta.
  if (a.phase === "create") {
    return (
      <PlaceWizard
        labels={wizardLabels}
        rootDomain={rootDomain}
        termsHref={termsHref}
        privacyHref={privacyHref}
        onSubmit={onCreatePlace}
        authed
      />
    );
  }

  if (a.phase === "choice") {
    return (
      <section className="mx-auto flex w-full max-w-[40rem] flex-col gap-6 px-6 py-16">
        <header className="flex flex-col gap-1 text-center">
          <h1 className="text-3xl text-ink">{l.choiceTitle}</h1>
          <p className="text-sm text-muted">{l.choiceSubtitle}</p>
        </header>
        <div className="grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={a.goCreate}
            className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-5 text-left hover:border-accent-strong"
          >
            <span className="text-lg text-ink">{l.createPlace}</span>
            <span className="text-sm text-muted">{l.createPlaceDesc}</span>
          </button>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-5 text-left opacity-60"
          >
            <span className="flex items-center gap-2 text-lg text-ink">
              {l.joinPlace}
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                {l.comingSoon}
              </span>
            </span>
            <span className="text-sm text-muted">{l.joinPlaceDesc}</span>
          </button>
        </div>
      </section>
    );
  }

  const termsParts = l.terms.split(/(\{terms\}|\{privacy\})/);

  return (
    <section className="mx-auto flex w-full max-w-[28rem] flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl text-ink">{l.title}</h1>
        <p className="text-sm text-muted">{l.subtitle}</p>
      </header>

      <div
        className="flex gap-2"
        role="group"
        aria-label={l.title}
      >
        {(["login", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={a.mode === m}
            onClick={() => a.switchMode(m)}
            className={`min-h-[2.75rem] flex-1 rounded-lg border px-4 text-sm ${
              a.mode === m
                ? "border-accent-strong text-ink"
                : "border-border text-muted"
            }`}
          >
            {m === "login" ? l.loginTab : l.signupTab}
          </button>
        ))}
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void a.handleSubmit();
        }}
      >
        {a.isSignup && (
          <div className="flex flex-col gap-2">
            <label
              htmlFor={a.ids.displayName}
              className="text-sm font-medium text-ink"
            >
              {l.displayNameLabel}
            </label>
            <input
              id={a.ids.displayName}
              type="text"
              value={a.displayName}
              placeholder={l.displayNamePlaceholder}
              onChange={(e) => a.setDisplayName(e.target.value)}
              onBlur={() => a.setDisplayNameTouched(true)}
              className={fieldClass}
            />
            {a.displayNameTouched && !a.displayNameValid && (
              <p className={errClass}>{l.displayNameRequired}</p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor={a.ids.email} className="text-sm font-medium text-ink">
            {l.emailLabel}
          </label>
          <input
            id={a.ids.email}
            type="email"
            value={a.email}
            placeholder={l.emailPlaceholder}
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(e) => a.setEmail(e.target.value)}
            onBlur={() => a.setEmailTouched(true)}
            className={fieldClass}
          />
          {a.emailTouched && !a.emailValid && (
            <p className={errClass}>{l.emailInvalid}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor={a.ids.password}
            className="text-sm font-medium text-ink"
          >
            {l.passwordLabel}
          </label>
          <input
            id={a.ids.password}
            type="password"
            value={a.password}
            placeholder={l.passwordPlaceholder}
            onChange={(e) => a.setPassword(e.target.value)}
            onBlur={() => a.setPasswordTouched(true)}
            className={fieldClass}
          />
          {a.isSignup && a.passwordTouched && !a.passwordValid ? (
            <p className={errClass}>{l.passwordTooShort}</p>
          ) : (
            a.isSignup && <p className="text-sm text-muted">{l.passwordHint}</p>
          )}
        </div>

        {a.isSignup && (
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={a.terms}
              onChange={(e) => a.setTerms(e.target.checked)}
              className="mt-1"
            />
            <span>
              {termsParts.map((part, i) => {
                if (part === "{terms}")
                  return (
                    <a
                      key={i}
                      href={termsHref}
                      className="text-accent-strong hover:underline"
                    >
                      {l.termsLinkLabel}
                    </a>
                  );
                if (part === "{privacy}")
                  return (
                    <a
                      key={i}
                      href={privacyHref}
                      className="text-accent-strong hover:underline"
                    >
                      {l.privacyLinkLabel}
                    </a>
                  );
                return <span key={i}>{part}</span>;
              })}
            </span>
          </label>
        )}

        {a.noticeText && (
          <p
            className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-ink"
            aria-live="polite"
          >
            {a.noticeText}
          </p>
        )}

        <button
          type="submit"
          disabled={a.submitting || !a.canSubmit}
          className="cta inline-flex min-h-[2.75rem] items-center justify-center rounded-lg px-6 text-base font-medium disabled:opacity-40"
        >
          {a.submitting
            ? l.submitting
            : a.isSignup
              ? l.signupSubmit
              : l.loginSubmit}
        </button>
      </form>

      <a
        href={homeHref}
        className="text-center text-sm text-muted hover:text-ink"
      >
        {l.back}
      </a>
    </section>
  );
}
