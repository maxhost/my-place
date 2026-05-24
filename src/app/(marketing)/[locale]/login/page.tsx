import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import {
  AccessFlow,
  type AccessLabels,
  type AccessSubmit,
  loginAction,
  signUpAccountAction,
} from "@/features/access/public";
import { rootDomain } from "@/shared/lib/root-domain";
import { getSessionJwt } from "@/shared/lib/session";
import { validateLoginReturnTo } from "@/shared/lib/sso";

// Ruta de la vía "Acceso" (S9, ADR-0008/0009 — simplificada por S5c del Hub
// V1, `docs/features/inbox/spec.md` §"Auth + redirects"). Server Component:
// traduce el namespace `access` → `labels` y pasa el locale al AccessFlow
// para que arme la URL del Hub post-auth. Los Server Actions vivos
// (`loginAction`/`signUpAccountAction`) se pasan como props (patrón canónico
// Server→Client; el flujo se testea con fakes, S9). Bajo `(marketing)/[locale]`
// → hereda `<html>`/skip-link del layout (S7). Tras S5c queda Dynamic (no
// SSG) por el guard de cookie del Hub.
//
// ADR-0033 (S11.3, 2026-05-23) — cold-start SSO M1: cuando el flow Signed
// Ticket (Feature C, ADR-0032) detecta visitor anónimo en custom domain sin
// sesión apex previa, `/api/auth/sso-issue` redirige a este login con
// `?returnTo=<URL completa al sso-issue>` para que tras login el user resuma
// el flow exactamente donde quedó (en lugar de aterrizar en el Hub canónico).
// La page lee `searchParams.returnTo`, lo valida con `validateLoginReturnTo`
// (helper PURE en `shared/lib/sso/`, S11.3.B: allowlist `sso-issue`/`sso-init`
// same-registrable-domain HTTPS + relative paths; cualquier otro → null), y
// propaga el destino sanitizado al AccessFlow (que lo honra en `onSuccess`).
// Backwards-compat: sin returnTo (ausente o inválido) → Hub canónico hardcoded
// idéntico al comportamiento pre-S11.3 (signup desde landing, login directo).

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ returnTo?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "access" });
  return { title: `${t("title")} — Place` };
}

export default async function LoginPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { returnTo: rawReturnTo } = await searchParams;
  setRequestLocale(locale);

  // Validación server-side single point del returnTo (ADR-0033 §"Contrato del
  // helper PURE validateLoginReturnTo"): rejects open-redirect, paths fuera
  // del allowlist, attacker domains, HTTP, scheme-relative. `rootDomain()` es
  // el host del apex (`place.community` prod, `localhost:3000` dev) usado para
  // la same-registrable-domain check. `safeReturnTo` es `string | null` —
  // `null` = caller usa fallback Hub canónico.
  const safeReturnTo = validateLoginReturnTo(rawReturnTo, rootDomain());

  // Guard: el user ya logueado se manda al Hub (S5b del Hub V1,
  // `docs/features/inbox/spec.md` §"Auth + redirects"). El /login del apex es
  // SÓLO para anónimos; con sesión vigente la vía natural es el Hub. Sin esto
  // un user logueado caería en el form de login y crearía la sesión otra vez.
  // ADR-0033: si vino `returnTo` válido (e.g. user con sesión apex activa que
  // vuelve manual a `/login?returnTo=...sso-issue...`), honrarlo igual — el
  // intent de reanudar el flow SSO supera el default Hub. Sin returnTo válido
  // → Hub canónico idéntico al comportamiento pre-S11.3.
  const token = await getSessionJwt();
  if (token !== null) {
    redirect(safeReturnTo ?? `https://app.place.community/${locale}/`);
  }

  const t = await getTranslations({ locale, namespace: "access" });

  const labels: AccessLabels = {
    title: t("title"),
    subtitle: t("subtitle"),
    loginTab: t("loginTab"),
    signupTab: t("signupTab"),
    emailLabel: t("emailLabel"),
    emailPlaceholder: t("emailPlaceholder"),
    emailInvalid: t("emailInvalid"),
    passwordLabel: t("passwordLabel"),
    passwordPlaceholder: t("passwordPlaceholder"),
    passwordHint: t("passwordHint"),
    passwordTooShort: t("passwordTooShort"),
    displayNameLabel: t("displayNameLabel"),
    displayNamePlaceholder: t("displayNamePlaceholder"),
    displayNameRequired: t("displayNameRequired"),
    // Plantilla que AccessFlow parte client-side ({terms}/{privacy}):
    // `t.raw` evita el FORMATTING_ERROR de next-intl (ver gotcha).
    terms: t.raw("terms"),
    termsLinkLabel: t("termsLinkLabel"),
    privacyLinkLabel: t("privacyLinkLabel"),
    termsRequired: t("termsRequired"),
    loginSubmit: t("loginSubmit"),
    signupSubmit: t("signupSubmit"),
    submitting: t("submitting"),
    loginFailedNotice: t("loginFailedNotice"),
    signupFailedNotice: t("signupFailedNotice"),
    back: t("back"),
  };

  const auth: AccessSubmit = {
    login: loginAction,
    signUp: signUpAccountAction,
  };

  return (
    <main id="contenido">
      <AccessFlow
        labels={labels}
        auth={auth}
        locale={locale}
        returnTo={safeReturnTo ?? undefined}
        termsHref={`/${locale}/terminos`}
        privacyHref={`/${locale}/privacidad`}
        homeHref={`/${locale}`}
      />
    </main>
  );
}
