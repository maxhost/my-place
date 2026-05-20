import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { signUpAccountAction } from "@/features/access/public";
import { createPlaceAction } from "@/features/place-creation/public";
import {
  PALETTE_PRESET_IDS,
  PlaceWizard,
  type WizardLabels,
} from "@/features/place-wizard/public";
import { rootDomain } from "@/shared/lib/root-domain";
import { getSessionJwt } from "@/shared/lib/session";

// Ruta de la vía place-first (CTA de la landing). Server Component: traduce
// el namespace `wizard` → `labels` (el wizard no carga runtime i18n en
// cliente, S8a) e inyecta el root domain de env. El Server Action
// `createPlaceAction` se pasa como prop `onSubmit` (patrón canónico
// Server→Client; el wizard se testea con un fake, S8b). Vive bajo
// `(marketing)/[locale]` → hereda `<html>`/skip-link del layout (S7).

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string }>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "wizard" });
  return { title: `${t("title")} — Place` };
}

export default async function CrearPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Guard: si el user ya tiene sesión y NO viene del Hub (`?from=hub`), lo
  // mandamos al Hub (S5b del Hub V1, `docs/features/inbox/spec.md`
  // §"Auth + redirects"). La excepción `?from=hub` cubre el CTA del estado
  // vacío del Hub ("Crear un lugar") — ese caso es entrada intencional al
  // wizard authed (S5c cablea el modo authed; en S5b sólo pasa el guard).
  const { from } = await searchParams;
  const fromHub = from === "hub";
  const token = await getSessionJwt();
  if (token !== null && !fromHub) {
    redirect(`https://app.place.community/${locale}/`);
  }

  const t = await getTranslations({ locale, namespace: "wizard" });

  const paletteNames: Record<string, string> = Object.fromEntries(
    PALETTE_PRESET_IDS.map((id) => [id, t(`palettes.${id}`)]),
  );

  const labels: WizardLabels = {
    title: t("title"),
    // Plantillas que el wizard rellena client-side ({n}, {slug}, {terms},
    // {url}): `t.raw` evita que next-intl corra el formatter ICU y tire
    // FORMATTING_ERROR por placeholders no provistos (ver gotcha).
    progress: t.raw("progress"),
    stepTitles: [t("steps.identity"), t("steps.style"), t("steps.account")],
    next: t("next"),
    back: t("back"),
    create: t("create"),
    creating: t("creating"),
    nameLabel: t("nameLabel"),
    namePlaceholder: t("namePlaceholder"),
    slugLabel: t("slugLabel"),
    slugHint: t.raw("slugHint"),
    slugReserved: t("slugReserved"),
    slugFormat: t("slugFormat"),
    slugAvailableHint: t("slugAvailableHint"),
    nameRequired: t("nameRequired"),
    previewLabel: t("previewLabel"),
    previewEmptyName: t("previewEmptyName"),
    guardrailNotice: t("guardrailNotice"),
    paletteLabel: t("paletteLabel"),
    paletteNames,
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
    terms: t.raw("terms"),
    termsLinkLabel: t("termsLinkLabel"),
    privacyLinkLabel: t("privacyLinkLabel"),
    termsRequired: t("termsRequired"),
    successTitle: t("successTitle"),
    successBody: t.raw("successBody"),
    successOpen: t("successOpen"),
    slugTakenNotice: t("slugTakenNotice"),
    invalidNotice: t("invalidNotice"),
    errorNotice: t("errorNotice"),
    accountFailedNotice: t("accountFailedNotice"),
    paletteModeLabel: t("paletteModeLabel"),
    paletteModePreset: t("paletteModePreset"),
    paletteModeCustom: t("paletteModeCustom"),
    paletteCustomTitle: t("paletteCustomTitle"),
    paletteCustomAccentLabel: t("paletteCustomAccentLabel"),
    paletteCustomBgLabel: t("paletteCustomBgLabel"),
    paletteCustomInkLabel: t("paletteCustomInkLabel"),
    paletteCustomHexInvalid: t("paletteCustomHexInvalid"),
    paletteCustomPickerSuffix: t("paletteCustomPickerSuffix"),
  };

  return (
    <main id="contenido">
      <PlaceWizard
        labels={labels}
        rootDomain={rootDomain()}
        termsHref={`/${locale}/terminos`}
        privacyHref={`/${locale}/privacidad`}
        onSubmit={createPlaceAction}
        onCreateAccount={signUpAccountAction}
      />
    </main>
  );
}
