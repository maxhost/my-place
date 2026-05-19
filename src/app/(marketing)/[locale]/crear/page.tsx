import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  PALETTE_PRESET_IDS,
  PlaceWizard,
  type WizardLabels,
  createPlaceAction,
} from "@/features/place-creation/public";
import { suggestStyleAction } from "@/features/style-assist/public";

// Ruta de la vía place-first (CTA de la landing). Server Component: traduce
// el namespace `wizard` → `labels` (el wizard no carga runtime i18n en
// cliente, S8a) e inyecta el root domain de env. El Server Action
// `createPlaceAction` se pasa como prop `onSubmit` (patrón canónico
// Server→Client; el wizard se testea con un fake, S8b). Vive bajo
// `(marketing)/[locale]` → hereda `<html>`/skip-link del layout (S7).

type Props = { params: Promise<{ locale: string }> };

// Root domain del subdominio público (mismo origen que el routing host-based,
// S7). Las URLs públicas son subdominio, sin path.
function rootDomain(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://place.community")
      .host;
  } catch {
    return "place.community";
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "wizard" });
  return { title: `${t("title")} — Place` };
}

export default async function CrearPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "wizard" });

  const paletteNames: Record<string, string> = Object.fromEntries(
    PALETTE_PRESET_IDS.map((id) => [id, t(`palettes.${id}`)]),
  );

  const labels: WizardLabels = {
    title: t("title"),
    progress: t("progress"),
    stepTitles: [t("steps.identity"), t("steps.style"), t("steps.account")],
    next: t("next"),
    back: t("back"),
    create: t("create"),
    creating: t("creating"),
    nameLabel: t("nameLabel"),
    namePlaceholder: t("namePlaceholder"),
    slugLabel: t("slugLabel"),
    slugHint: t("slugHint"),
    slugReserved: t("slugReserved"),
    slugFormat: t("slugFormat"),
    slugAvailableHint: t("slugAvailableHint"),
    nameRequired: t("nameRequired"),
    previewLabel: t("previewLabel"),
    previewEmptyName: t("previewEmptyName"),
    guardrailNotice: t("guardrailNotice"),
    descriptionLabel: t("descriptionLabel"),
    descriptionPlaceholder: t("descriptionPlaceholder"),
    descriptionHint: t("descriptionHint"),
    descriptionTooLong: t("descriptionTooLong"),
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
    terms: t("terms"),
    termsLinkLabel: t("termsLinkLabel"),
    privacyLinkLabel: t("privacyLinkLabel"),
    termsRequired: t("termsRequired"),
    successTitle: t("successTitle"),
    successBody: t("successBody"),
    successOpen: t("successOpen"),
    slugTakenNotice: t("slugTakenNotice"),
    invalidNotice: t("invalidNotice"),
    errorNotice: t("errorNotice"),
    assistButton: t("assistButton"),
    assistLoading: t("assistLoading"),
    assistNeedDescription: t("assistNeedDescription"),
    assistUnavailable: t("assistUnavailable"),
    assistProposedTitle: t("assistProposedTitle"),
    assistProposedHint: t("assistProposedHint"),
    assistPaletteLabel: t("assistPaletteLabel"),
    assistDescriptionLabel: t("assistDescriptionLabel"),
    assistApplyPalette: t("assistApplyPalette"),
    assistApplyDescription: t("assistApplyDescription"),
    assistApplied: t("assistApplied"),
  };

  return (
    <main id="contenido">
      <PlaceWizard
        labels={labels}
        rootDomain={rootDomain()}
        termsHref={`/${locale}/terminos`}
        privacyHref={`/${locale}/privacidad`}
        onSubmit={createPlaceAction}
        onSuggest={suggestStyleAction}
      />
    </main>
  );
}
