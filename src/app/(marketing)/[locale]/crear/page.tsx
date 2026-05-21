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
import { type Locale, routing } from "@/i18n/routing";
import { rootDomain } from "@/shared/lib/root-domain";
import { getSessionJwt } from "@/shared/lib/session";

// Ruta de la vía place-first (CTA de la landing) + entrada authed desde el
// Hub (CTA "Crear un lugar" del estado vacío, S5c del Hub V1,
// `docs/features/inbox/spec.md` §"Empty state"). Server Component: traduce
// el namespace `wizard` → `labels` (el wizard no carga runtime i18n en
// cliente, S8a) e inyecta el root domain de env. El Server Action
// `createPlaceAction` se pasa como prop `onSubmit`; `signUpAccountAction` se
// pasa como `onCreateAccount` SÓLO en modo place-first (anónimo) — en modo
// authed (?from=hub) no se usa porque la sesión ya existe (patrón canónico
// Server→Client; el wizard se testea con un fake, S8b). Vive bajo
// `(marketing)/[locale]` → hereda `<html>`/skip-link del layout (S7).
//
// Dos modos según query string:
//   - place-first (default): 3 pasos (Identidad, Estilo, Cuenta). Anónimo;
//     el wizard crea la cuenta antes de crear el place (two-phase).
//   - authed (?from=hub): 2 pasos (Identidad, Estilo). El user YA está
//     logueado; el guard deja pasar SÓLO con `?from=hub` y el wizard
//     omite el Paso 3 (`authed={true}`) — ADR-0008 §3.

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
  // wizard authed.
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

  // ADR-0022 + ADR-0024: endonyms (auto-nombres) de los 6 locales operativos.
  // El selector del Paso 1 los renderea con el orden de `routing.locales`. El
  // namespace `wizard.locales` los duplica como i18n keys para mantener la
  // disciplina (cualquier copy del producto pasa por `messages/<locale>.json`)
  // — aunque los valores sean idénticos en todos los catálogos por definición.
  const defaultLocaleOptions = Object.fromEntries(
    routing.locales.map((loc) => [loc, t(`locales.${loc}`)]),
  ) as Record<Locale, string>;

  // stepTitles define el step count del wizard (use-place-wizard.ts:49). En
  // modo authed el wizard omite el Paso 3 (cuenta) — pasamos 2 títulos; en
  // place-first pasamos los 3.
  const stepTitles = fromHub
    ? [t("steps.identity"), t("steps.style")]
    : [t("steps.identity"), t("steps.style"), t("steps.account")];

  const labels: WizardLabels = {
    title: t("title"),
    // Plantillas que el wizard rellena client-side ({n}, {slug}, {terms},
    // {url}): `t.raw` evita que next-intl corra el formatter ICU y tire
    // FORMATTING_ERROR por placeholders no provistos (ver gotcha).
    progress: t.raw("progress"),
    stepTitles,
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
    defaultLocaleLabel: t("defaultLocaleLabel"),
    defaultLocaleOptions,
  };

  return (
    <main id="contenido">
      <PlaceWizard
        labels={labels}
        rootDomain={rootDomain()}
        termsHref={`/${locale}/terminos`}
        privacyHref={`/${locale}/privacidad`}
        onSubmit={createPlaceAction}
        onCreateAccount={fromHub ? undefined : signUpAccountAction}
        authed={fromHub}
        defaultLocale={locale as Locale}
      />
    </main>
  );
}
