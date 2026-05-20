import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  AccessFlow,
  type AccessLabels,
  type AccessSubmit,
  loginAction,
  signUpAccountAction,
} from "@/features/access/public";
import { createPlaceAction } from "@/features/place-creation/public";
import {
  PALETTE_PRESET_IDS,
  type WizardLabels,
} from "@/features/place-wizard/public";
import { rootDomain } from "@/shared/lib/root-domain";

// Ruta de la vía "Acceso" (S9, ADR-0008/0009): item distinto del CTA. Server
// Component: traduce los namespaces `access` (form/elección) y `wizard`
// (wizard reusado en modo authed, SIN el paso de cuenta → stepTitles de 2) →
// `labels`. Los Server Actions vivos (`loginAction`/`signUpAccountAction`/
// `createPlaceAction`) se pasan como props (patrón canónico Server→Client; el
// flujo se testea con fakes, S9). Bajo `(marketing)/[locale]` → hereda
// `<html>`/skip-link del layout (S7); SSG en los 4 locales.

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "access" });
  return { title: `${t("title")} — Place` };
}

export default async function LoginPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "access" });
  const w = await getTranslations({ locale, namespace: "wizard" });

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
    choiceTitle: t("choiceTitle"),
    choiceSubtitle: t("choiceSubtitle"),
    createPlace: t("createPlace"),
    createPlaceDesc: t("createPlaceDesc"),
    joinPlace: t("joinPlace"),
    joinPlaceDesc: t("joinPlaceDesc"),
    comingSoon: t("comingSoon"),
    back: t("back"),
  };

  const paletteNames: Record<string, string> = Object.fromEntries(
    PALETTE_PRESET_IDS.map((id) => [id, w(`palettes.${id}`)]),
  );

  // Wizard reusado en modo authed: 2 pasos (Identidad + Estilo), sin cuenta.
  const wizardLabels: WizardLabels = {
    title: w("title"),
    // Plantillas que el wizard rellena client-side: `w.raw` (ver gotcha).
    progress: w.raw("progress"),
    stepTitles: [w("steps.identity"), w("steps.style")],
    next: w("next"),
    back: w("back"),
    create: w("create"),
    creating: w("creating"),
    nameLabel: w("nameLabel"),
    namePlaceholder: w("namePlaceholder"),
    slugLabel: w("slugLabel"),
    slugHint: w.raw("slugHint"),
    slugReserved: w("slugReserved"),
    slugFormat: w("slugFormat"),
    slugAvailableHint: w("slugAvailableHint"),
    nameRequired: w("nameRequired"),
    previewLabel: w("previewLabel"),
    previewEmptyName: w("previewEmptyName"),
    guardrailNotice: w("guardrailNotice"),
    paletteLabel: w("paletteLabel"),
    paletteNames,
    emailLabel: w("emailLabel"),
    emailPlaceholder: w("emailPlaceholder"),
    emailInvalid: w("emailInvalid"),
    passwordLabel: w("passwordLabel"),
    passwordPlaceholder: w("passwordPlaceholder"),
    passwordHint: w("passwordHint"),
    passwordTooShort: w("passwordTooShort"),
    displayNameLabel: w("displayNameLabel"),
    displayNamePlaceholder: w("displayNamePlaceholder"),
    displayNameRequired: w("displayNameRequired"),
    terms: w.raw("terms"),
    termsLinkLabel: w("termsLinkLabel"),
    privacyLinkLabel: w("privacyLinkLabel"),
    termsRequired: w("termsRequired"),
    successTitle: w("successTitle"),
    successBody: w.raw("successBody"),
    successOpen: w("successOpen"),
    slugTakenNotice: w("slugTakenNotice"),
    invalidNotice: w("invalidNotice"),
    errorNotice: w("errorNotice"),
    accountFailedNotice: w("accountFailedNotice"),
    paletteModeLabel: w("paletteModeLabel"),
    paletteModePreset: w("paletteModePreset"),
    paletteModeCustom: w("paletteModeCustom"),
    paletteCustomTitle: w("paletteCustomTitle"),
    paletteCustomAccentLabel: w("paletteCustomAccentLabel"),
    paletteCustomBgLabel: w("paletteCustomBgLabel"),
    paletteCustomInkLabel: w("paletteCustomInkLabel"),
    paletteCustomHexInvalid: w("paletteCustomHexInvalid"),
    paletteCustomPickerSuffix: w("paletteCustomPickerSuffix"),
  };

  const auth: AccessSubmit = {
    login: loginAction,
    signUp: signUpAccountAction,
  };

  return (
    <main id="contenido">
      <AccessFlow
        labels={labels}
        wizardLabels={wizardLabels}
        auth={auth}
        onCreatePlace={createPlaceAction}
        rootDomain={rootDomain()}
        termsHref={`/${locale}/terminos`}
        privacyHref={`/${locale}/privacidad`}
        homeHref={`/${locale}`}
      />
    </main>
  );
}
