import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { acceptInvitationAction } from "@/features/invitations/public";
import { logoutAction } from "@/features/nav-hub/public";
import { routing } from "@/i18n/routing";
import {
  buildApexLoginUrl,
  buildPlaceCanonicalUrl,
} from "@/shared/lib/auth-redirect";
import { getCurrentUserIdentityForRequest } from "@/shared/lib/current-user-identity";
import { isServiceableSlug } from "@/shared/lib/host-routing";
import { rootDomain } from "@/shared/lib/root-domain";

import { getPlaceLocaleFallback } from "../../_lib/get-place-for-zone";
import {
  InviteAcceptancePanel,
  type InviteAcceptancePanelLabels,
} from "./_components/invite-acceptance-panel";
import { getInvitationMetaByToken } from "./_lib/get-invitation-meta-by-token";

// V1.1 S3 — page RSC `/place/[placeSlug]/invite/[token]` (Feature E Accept
// Flow, ADR-0044). El proxy reescribe `{slug}.place.community/invite/{tok}`
// → `/place/{slug}/invite/{tok}` (multi-tenancy.md). Vive bajo zona-place
// para heredar el `<html lang>` dinámico del layout y para que el
// cross-place tampering check (RSC vs DB) sea natural.
//
// ## Pipeline
//
// 1. Gate estructural del `placeSlug` (`isServiceableSlug`) — formato +
//    no-reservado. Antes de cualquier I/O.
// 2. `getInvitationMetaByToken(token, placeSlug)` — wraps
//    `app.invitation_preview` + tampering check + token shape gate. Cualquier
//    `kind !== 'ok'` → `notFound()` (404 sin doxx, anti-info-leak).
// 3. Session detect via `getCurrentUserIdentityForRequest()` — RSC zone-aware
//    unificado (ADR-0046 §"Addendum operacional — Sesión D.fix.3", 2026-05-27,
//    supersede al `getCurrentUserEmailForRequest` de D.fix.1). Lee la cookie
//    correcta según la zona (Neon Auth en apex/subdomain/inbox; SSO local en
//    custom domain) via el coordinator `getAuthenticatedDbForRequest` (ADR-
//    0034). El invitee típicamente NO es owner del place, así que `getPlace
//    ForZone` retornaría null sin agregar info. Acá usamos sólo `.email` para
//    decidir match/mismatch — el integrator también expone `authUserId` y
//    `displayName` que el Server Action consume.
// 4. Locale resolution: `place.default_locale` no es lecturable owner-only
//    sin sesión apex válida, así que para el invitee anónimo usamos el
//    lookup anónimo `getPlaceLocaleFallback(placeSlug)` (memoizado por
//    render con el layout). Fallback `routing.defaultLocale` ('es').
// 5. URL composition: loginUrl + signupUrl con `returnTo` absoluto al
//    invite URL; hubUrl = `app.${rootDomain}/${locale}/`; placeHomeUrl =
//    subdomain canon home.
// 6. Render `<InviteAcceptancePanel>` con todas las props derivadas + el
//    `acceptInvitationAction` server inyectado + `logoutAction.bind(null,
//    locale)` para el mismatch CTA.
//
// ## i18n
//
// V1.1 S4 — namespace `placeInvitation` (13 keys × 6 locales) consumido via
// `getTranslations({locale, namespace: "placeInvitation"})`. El locale viene
// del lookup anónimo `getPlaceLocaleFallback(placeSlug)` (no del cookie del
// visitor): los labels respetan el `default_locale` del place, no la
// preferencia del visitor anónimo. Coherente con el resto del shell zona-
// place (ADR-0024 §"locale de un place es del place").
//
// ## Dynamic + region
//
// `force-dynamic` porque el render depende de cookie + DB; nada SSG-
// cacheable. `preferredRegion = "iad1"` por co-location con Neon
// (architecture.md §Performance).

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

type Props = {
  params: Promise<{ placeSlug: string; token: string }>;
};

function isAppLocale(value: string | null): value is string {
  return value !== null && (routing.locales as readonly string[]).includes(value);
}

export default async function InviteAcceptPage({ params }: Props) {
  const { placeSlug, token } = await params;

  // (1) Gate estructural del slug — antes de cualquier I/O.
  if (!isServiceableSlug(placeSlug)) notFound();

  // (2) Preview + cross-place tampering + token shape gate. Anti-info-leak:
  // not-found Y cross-place-tampering ambos colapsan a 404 sin pistas.
  const meta = await getInvitationMetaByToken(token, placeSlug);
  if (meta.kind !== "ok") notFound();

  // (3) Session detect zone-aware unificado (ADR-0046 §"Addendum operacional
  // — Sesión D.fix.3"). Custom domain monta cookie local SSO host-only (no
  // apex JWT), así que el coordinator detecta la zona y lee la cookie
  // correcta. El invitee típicamente NO es owner del place, así que no usamos
  // `getPlaceForZone` (RLS retornaría null sin info útil). Acá descartamos
  // `authUserId` + `displayName`; sólo el email decide match/mismatch en el
  // panel — el integrator es el mismo que el Server Action consume completo,
  // single source of truth zone-aware (cierra Bug B del smoke V1.2 2x2).
  const currentUserEmail =
    (await getCurrentUserIdentityForRequest())?.email ?? null;

  // (4) Locale resolution. Visitor anónimo / non-owner: `place.default_
  // locale` no es lecturable sin sesión owner. `getPlaceLocaleFallback`
  // (memoizado por render con el layout) abre el canal anónimo via
  // `app.lookup_place_locale_by_slug` (SECURITY DEFINER). Fallback canónico
  // 'es' (ADR-0024 §default).
  const localeFallback = await getPlaceLocaleFallback(placeSlug);
  const locale: string = isAppLocale(localeFallback)
    ? localeFallback
    : routing.defaultLocale;

  // (5) URL composition. V1.2 Sesión A (ADR-0046 §D1): el invite URL y el
  // place home son zone-aware — si el place tiene custom domain verified,
  // ambos apuntan al custom domain (`https://nocodecompany.co/...`); si no,
  // caen al subdomain canon (zero regresión). La lookup interna está
  // memoizada con React.cache, así que las 2 invocaciones acá comparten
  // una sola query Neon iad1 dentro del render.
  const placeBaseUrl = (
    await buildPlaceCanonicalUrl({ slug: placeSlug, path: "/" })
  ).replace(/\/$/, "");
  const inviteUrl = `${placeBaseUrl}/invite/${token}`;
  const returnToParam = encodeURIComponent(inviteUrl);

  // V1.2 Sesión B (ADR-0046 §D2): `&invite={token}` dispara el branding
  // apex del `<AccessFlow>` ("Te invitan a unirte a {placeName}" + esconde
  // toggle + redirige post-success al `postCredentialUrl`). El `/login` lo
  // resuelve server-side via `lookupInvitationPreview`. El returnTo sigue
  // viajando (para entry points pre-V1.2 / fallback de orden de prioridad
  // del `<AccessFlow>`), pero el `inviteContext.postCredentialUrl` gana
  // cuando ambos están presentes.
  const inviteParam = `&invite=${encodeURIComponent(token)}`;

  const baseLoginUrl = buildApexLoginUrl({ defaultLocale: locale });
  const loginUrl = `${baseLoginUrl}?returnTo=${returnToParam}${inviteParam}`;

  // Signup CTA apunta al mismo apex `/login` con `?mode=signup` (ADR-0045
  // §D1, supersede ADR-0044 §D3). Razón: `/login` ya tiene tab signup +
  // honra returnTo (ADR-0033, allowlist V1.1 S2). El param `mode` pre-
  // selecciona el tab signup al primer render (ADR-0045 §D2/D3) para que
  // el CTA "Crear cuenta" sea coherente con lo que el user ve al aterrizar.
  // `/crear` (PlaceWizard 3-pasos) queda intacto — el invitee no quiere
  // crear un place propio, sólo una cuenta para aceptar la invitación.
  const signupUrl = `${baseLoginUrl}?returnTo=${returnToParam}&mode=signup${inviteParam}`;

  const hubUrl = `https://app.${rootDomain()}/${locale}/`;
  const placeHomeUrl = await buildPlaceCanonicalUrl({
    slug: placeSlug,
    path: "/",
  });

  // (6) i18n labels desde el namespace `placeInvitation`, scoped al locale
  // resuelto en (4). El panel mantiene su API: recibe el shape
  // `InviteAcceptancePanelLabels` ya hidratado, con placeholders `{var}` que
  // resuelve internamente via su helper `interpolate`. Mapeo inline aquí
  // porque las 13 keys son planas (no nested) — sin necesidad de extraer un
  // builder helper como `build-shell-labels.ts` del Members slice.
  const t = await getTranslations({ locale, namespace: "placeInvitation" });
  const labels: InviteAcceptancePanelLabels = {
    header: t("header"),
    previewEmail: t("previewEmail"),
    acceptButton: t("acceptButton"),
    declineLink: t("declineLink"),
    ctaLogin: t("ctaLogin"),
    ctaSignup: t("ctaSignup"),
    emailMismatchTitle: t("emailMismatchTitle"),
    emailMismatchBody: t("emailMismatchBody"),
    emailMismatchLogoutCta: t("emailMismatchLogoutCta"),
    errorExpired: t("errorExpired"),
    errorAlreadyUsed: t("errorAlreadyUsed"),
    errorPlaceFull: t("errorPlaceFull"),
    // Phase 0.D — placeholder `{seconds}` interpolado client-side; t.raw
    // para no triggear el ICU parse de next-intl sin var explicit.
    errorRateLimited: t.raw("errorRateLimited"),
    errorUnknown: t("errorUnknown"),
  };

  // `onLogout`: Server Action bind sobre `logoutAction(locale)` — invoca
  // `getAuth().signOut()` y retorna el `redirectTo` del apex landing
  // (descartado por el panel, que navega a `loginUrl` con returnTo).
  const onLogout = logoutAction.bind(null, locale);

  return (
    <main id="contenido" className="flex min-h-screen flex-col">
      <InviteAcceptancePanel
        token={token}
        placeName={meta.placeName}
        inviteeEmail={meta.inviteeEmail}
        currentUserEmail={currentUserEmail}
        loginUrl={loginUrl}
        signupUrl={signupUrl}
        hubUrl={hubUrl}
        placeHomeUrl={placeHomeUrl}
        acceptInvitationAction={acceptInvitationAction}
        onLogout={onLogout}
        labels={labels}
      />
    </main>
  );
}
