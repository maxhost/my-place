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
import { getSessionJwt } from "@/shared/lib/session";

// Ruta de la vía "Acceso" (S9, ADR-0008/0009 — simplificada por S5c del Hub
// V1, `docs/features/inbox/spec.md` §"Auth + redirects"). Server Component:
// traduce el namespace `access` → `labels` y pasa el locale al AccessFlow
// para que arme la URL del Hub post-auth. Los Server Actions vivos
// (`loginAction`/`signUpAccountAction`) se pasan como props (patrón canónico
// Server→Client; el flujo se testea con fakes, S9). Bajo `(marketing)/[locale]`
// → hereda `<html>`/skip-link del layout (S7). Tras S5c queda Dynamic (no
// SSG) por el guard de cookie del Hub.

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "access" });
  return { title: `${t("title")} — Place` };
}

export default async function LoginPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Guard: el user ya logueado se manda al Hub (S5b del Hub V1,
  // `docs/features/inbox/spec.md` §"Auth + redirects"). El /login del apex es
  // SÓLO para anónimos; con sesión vigente la vía natural es el Hub. Sin esto
  // un user logueado caería en el form de login y crearía la sesión otra vez.
  const token = await getSessionJwt();
  if (token !== null) {
    redirect(`https://app.place.community/${locale}/`);
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
        termsHref={`/${locale}/terminos`}
        privacyHref={`/${locale}/privacidad`}
        homeHref={`/${locale}`}
      />
    </main>
  );
}
