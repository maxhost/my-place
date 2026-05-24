"use client";

import type { AccessLabels, AccessSubmit } from "./access-labels";
import { useAccessForm } from "./use-access-form";

// Vía "Acceso" (S9, ADR-0008/0009 — simplificada por S5c del Hub V1,
// `docs/features/inbox/spec.md` §"Auth + redirects"): form account-first
// (login | signup) → navigate cross-subdomain al Hub
// (`app.place.community/{locale}/`). La elección post-auth se eliminó: el Hub
// ya cubre "Crear un lugar" (CTA del estado vacío → `/crear?from=hub` →
// wizard authed) y "Unirme" (deshabilitado, ADR-0009 §2). Esta simplificación
// elimina la dependencia de `place-wizard` y deja el slice acíclico puro
// (sólo `place-creation` para el tipo `PlaceFirstCredentials`).
//
// Componente CLIENTE; la máquina vive en `useAccessForm`. Textos por prop
// `labels` (serializable, sin runtime i18n — mismo ethos que el wizard, S8a)
// y el borde cross-system por puertos: `auth` (Neon Auth) + `navigate`
// (window.location.assign por default, mockeable en tests sin tocar el global
// — mismo patrón que `NavHubLayout` del Hub). `producto.md` cozytech: nada
// alarma, avisos calmos.

const fieldClass =
  "min-h-[2.75rem] rounded-lg border border-border bg-surface px-3 text-base text-ink";
const errClass = "text-sm text-accent-strong";

function defaultNavigate(url: string) {
  window.location.assign(url);
}

export function AccessFlow({
  labels,
  auth,
  locale,
  returnTo,
  termsHref,
  privacyHref,
  homeHref,
  navigate = defaultNavigate,
}: {
  labels: AccessLabels;
  auth: AccessSubmit;
  /** Locale activo para construir la URL del Hub post-auth. */
  locale: string;
  /** ADR-0033 (S11.3.C) — override del destino post-auth. La page apex de
   *  login propaga el `searchParams.returnTo` SÓLO si pasa
   *  `validateLoginReturnTo` (helper PURE en `shared/lib/sso/`, S11.3.B):
   *  allowlist `sso-issue`/`sso-init` + same-registrable-domain HTTPS +
   *  relative paths. **NUNCA confiar en este input client-side sin
   *  validación server-side previa** — el componente sólo lo navega.
   *  Sin returnTo (ausente o inválido en la page) → Hub canónico
   *  default (backwards-compat con signup/login pre-Feature-C). */
  returnTo?: string;
  termsHref: string;
  privacyHref: string;
  homeHref: string;
  /** Inyectable para tests; en prod default = window.location.assign. */
  navigate?: (url: string) => void;
}) {
  const a = useAccessForm({
    labels,
    auth,
    // Closure sobre `returnTo`: la decisión vive aquí (no en el hook), que
    // se mantiene agnóstico del destino post-auth. Decisión documentada en
    // ADR-0033 §"Wire-up useAccessForm" — superficie del hook intacta.
    onSuccess: () =>
      navigate(returnTo ?? `https://app.place.community/${locale}/`),
  });
  const l = labels;

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
