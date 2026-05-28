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
import { buildSsoInitUrlForInvite } from "@/shared/lib/auth-redirect";
import { lookupInvitationPreview } from "@/shared/lib/invitation-preview-lookup";
import { resolvePostCredentialDestination } from "@/shared/lib/post-credential-destination";
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
//
// ADR-0045 (V1.1 S5, 2026-05-26) — invite signup CTA via `/login?mode=signup`:
// param opcional `?mode=login|signup` con whitelist strict + fallback `login`.
// Pre-selecciona el tab activo al primer render del AccessFlow (initialMode).
// El CTA "Crear cuenta" del invite page (`/invite/{token}`) lo usa para que el
// invitee aterrice directo en el form de signup. Cualquier valor distinto de
// `"signup"` cae al default `"login"` (typo del developer, URL maliciosa,
// browser history corruption — todos colapsan a login tab sin error visible).
//
// ADR-0046 (V1.2 Sesiones B+C, 2026-05-26) — invite branding apex + silent
// SSO post-credential: param opcional `?invite={token}`. Cuando presente Y
// `lookupInvitationPreview(token)` retorna no-null (token válido), la page
// deriva `placeSlug` + `placeName` + `postCredentialUrl` server-side y pasa
// `inviteContext` al `<AccessFlow>`. El componente reemplaza el header por
// branding del place inviting + esconde el toggle login/signup + redirige
// post-success al `postCredentialUrl`. Si el token es inválido / vencido /
// usado / drift, la page degrada al flow login default sin branding (anti-
// info-leak: NO leak "este token no existe"). El `postCredentialUrl` se
// construye via `buildSsoInitUrlForInvite({slug, token})` — zone-aware con
// silent SSO embebido (Sesión C): places con custom domain reciben URL al
// `sso-init` del custom domain (Feature C cadena init→issue→redeem mintea
// cookie local), places sin custom domain reciben subdomain canon directo
// (cookie apex .place.community propaga al subdomain sin SSO necesario).

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    returnTo?: string;
    mode?: string;
    invite?: string;
  }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "access" });
  return { title: `${t("title")} — Place` };
}

export default async function LoginPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const {
    returnTo: rawReturnTo,
    mode: rawMode,
    invite: rawInvite,
  } = await searchParams;
  setRequestLocale(locale);

  // ADR-0045 §D2 — whitelist strict del param `mode`. Sólo `"signup"` switchea
  // al tab signup pre-seleccionado; cualquier otro valor (incluido `undefined`,
  // `"login"` literal, typos, injection attempts) cae al default. Sin throw,
  // sin validation error visible al user — un param inválido se ignora
  // silenciosamente y el page renderiza el default login tab.
  const initialMode: "login" | "signup" =
    rawMode === "signup" ? "signup" : "login";

  // ADR-0046 §D2 (V1.2 Sesión B) — `?invite={token}` lookup server-side. Si el
  // token está presente Y es válido (pasa shape gate + DEFINER retorna row),
  // derivamos `inviteContext` para pasar al `<AccessFlow>`. Cualquier fallo
  // (token ausente, shape inválido, vencido, usado, drift, DB error) colapsa a
  // null SIN diferenciar la causa (anti-info-leak per `lookupInvitationPreview`).
  // En ese caso el page renderiza el login default sin branding — el invitee
  // que aterriza con token inválido ve flow normal sin pistas de qué falló.
  const invitePreview =
    typeof rawInvite === "string"
      ? await lookupInvitationPreview(rawInvite)
      : null;
  const inviteContext = invitePreview
    ? {
        placeSlug: invitePreview.placeSlug,
        placeName: invitePreview.placeName,
        // Zone-aware (Sesión A) + silent SSO embebido (Sesión C, ADR-0046 §D4):
        // si el place tiene custom domain verified, `postCredentialUrl` apunta
        // al `sso-init` del custom domain (que dispara la cadena init→issue→
        // redeem para mintear cookie local). Si no, apunta directo al subdomain
        // canon (la cookie apex .place.community propaga sin SSO necesario).
        postCredentialUrl: await buildSsoInitUrlForInvite({
          slug: invitePreview.placeSlug,
          token: rawInvite!.trim().toLowerCase(),
        }),
      }
    : undefined;

  // Validación server-side single point del returnTo (ADR-0033 §"Contrato del
  // helper PURE validateLoginReturnTo"): rejects open-redirect, paths fuera
  // del allowlist, attacker domains, HTTP, scheme-relative. `rootDomain()` es
  // el host del apex (`place.community` prod, `localhost:3000` dev) usado para
  // la same-registrable-domain check. `safeReturnTo` es `string | null` —
  // `null` = caller usa fallback Hub canónico.
  const safeReturnTo = validateLoginReturnTo(rawReturnTo, rootDomain());

  // Guard: el user ya logueado se manda al Hub (S5b del Hub V1,
  // `docs/features/inbox/spec.md` §"Auth + redirects"). El /login del apex es
  // SÓLO para anónimos; con sesión vigente la vía natural es el Hub.
  // ADR-0033: si vino `returnTo` válido (e.g. user con sesión apex activa que
  // vuelve manual a `/login?returnTo=...sso-issue...`), honrarlo — el intent
  // de reanudar el flow SSO supera el default Hub.
  // ADR-0046 §"Addendum operacional — Sesión D" (V1.2): si vino `?invite=
  // {token}` con preview válido, el `inviteContext.postCredentialUrl` gana
  // sobre returnTo. Wire al helper PURE compartido con `AccessFlow.onSuccess`
  // (single source of truth del orden). Sin esto, el guard server-side se
  // disparaba durante post-revalidate de Server Actions (Next.js auto-
  // revalidate header `x-action-revalidated: 1`) y override la nav client-
  // side al Hub default ignorando inviteContext — bug E2E disparado en V1.2
  // smoke matriz 2x2. Gotcha: `docs/gotchas/server-action-revalidation-
  // overrides-client-navigation.md`.
  const token = await getSessionJwt();
  if (token !== null) {
    redirect(
      resolvePostCredentialDestination({
        inviteContext,
        returnTo: safeReturnTo,
        hubFallback: `https://app.place.community/${locale}/`,
      }),
    );
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
    // Phase 0.D — placeholder `{seconds}` interpolado client-side; t.raw
    // para no triggear el ICU parse de next-intl sin var explicit.
    rateLimitedNotice: t.raw("rateLimitedNotice"),
    back: t("back"),
    // ADR-0046 §D2 — branding apex del invite flow. `t.raw` para inviteTitle
    // porque tiene `{placeName}` placeholder que AccessFlow interpola client-
    // side (mismo patrón que `terms`). Las otras 2 keys son strings planos.
    inviteTitle: t.raw("inviteTitle"),
    inviteSubtitle: t("inviteSubtitle"),
    inviteAcceptHint: t("inviteAcceptHint"),
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
        initialMode={initialMode}
        inviteContext={inviteContext}
        termsHref={`/${locale}/terminos`}
        privacyHref={`/${locale}/privacidad`}
        homeHref={`/${locale}`}
      />
    </main>
  );
}
