import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import {
  SsoFallbackPanel,
  type SsoFallbackLabels,
} from "@/features/custom-domain-routing/public";
import { logoutAction } from "@/features/nav-hub/public";
import {
  NavPlaceLayout,
  type NavPlaceLabels,
} from "@/features/nav-place/public";
import { type PlaceLocale, PLACE_LOCALES } from "@/features/place/public";
import {
  LocaleSection,
  type LocaleSectionLabels,
  updateDefaultLocaleAction,
} from "@/features/place-settings/public";
import {
  buildApexLoginUrl,
  buildSubdomainCanonicalUrl,
} from "@/shared/lib/auth-redirect";
import { isServiceableSlug } from "@/shared/lib/host-routing";
import {
  getHostZoneForZone,
  getPlaceForZone,
  getPlaceLocaleFallback,
  getSessionTokenForZone,
} from "../_lib/get-place-for-zone";

// Page del settings — `{slug}.place.community/settings` (proxy reescribe a
// `/place/{slug}/settings`, `docs/multi-tenancy.md`). S6 del feature
// `settings` (`docs/features/settings/spec.md` §"Auth guard mechanism")
// + Feature B S4d (ADR-0031) + Feature C S10 (ADR-0032 §"UX silent SSO +
// fallback panel", 2026-05-23).
//
// Server Component que orquesta el seam-split del settings V1, paralelo al
// page del Hub (`(app)/inbox/[locale]/page.tsx`):
//
// 1. Gate estructural del slug (`isServiceableSlug`) — formato/reservados.
// 2. Resolución del host-zone (`getHostZoneForZone`, memoizado con el
//    layout). Determina si la request entra por subdomain canon o por
//    custom domain — necesario para decidir el branch de no-sesión en (3).
// 3. Guard sesión cross-subdomain (`getSessionTokenForZone()` — memoizado
//    junto al layout vía `React.cache()`). Sin sesión, branchea por zona:
//      a. **Custom domain** (Feature C S10, refina Feature B S4d): la cookie
//         Neon Auth `Domain=.place.community` NO acompaña al custom host
//         (RFC 6265). Antes de Feature C el branch renderizaba
//         `<AuthGateForCustomDomain>` directo (gate educativa V1); ahora el
//         flow es **silent SSO primero**:
//           - Sin `?sso_error=` en query → `redirect('/api/auth/sso-init?
//             returnTo=/settings')`. El init genera state/nonce + setea
//             cookie host-only + redirige al issuer apex (S8). Si el owner
//             tiene sesión Neon Auth, el round-trip aterriza acá con la
//             cookie `__Host-place_sso_session` seteada → branch (3.a) ya
//             no aplica, cae al happy path en (4).
//           - Con `?sso_error=<code>` (el redeem rebotó) → render del
//             `<SsoFallbackPanel>` (S6) con `errorCode` mostrado para debug
//             del owner + CTA al subdomain canon (`buildSubdomainCanonicalUrl`,
//             S4c) donde la cookie `.place.community` sí está scopeada (=
//             el plan B, ahora secundario al silent SSO automático).
//         Sin counter de attempts V1 (decisión documentada en plan-sesiones
//         §S10): si el owner reintenta y vuelve a fallar, ve el panel otra
//         vez. Sin loops automáticos.
//      b. **Subdomain canon** (Feature B S4c): redirect cross-subdomain al
//         login del apex (`buildApexLoginUrl`). El locale del redirect
//         proviene del lookup anónimo S4b (`getPlaceLocaleFallback`,
//         memoizado por render). Antes de S4c era hardcoded
//         `"https://place.community/es/login"` — locale fijo (bug pre-existente).
// 4. Carga del place vía `getPlaceForZone(placeSlug)` (memoizado).
//    Sabemos que hay sesión por (3), así que `null` ⇒ no-owner (RLS) o slug
//    no existente o archivado → `notFound()` (la 404 de la zona-place se
//    sirve sin pistas de "no tenés permiso", spec §"Journeys C").
// 5. i18n DB-based: `getTranslations({locale: place.defaultLocale, namespace:
//    "placeSettings"})` toma el override de locale del place (ADR-0024,
//    patrón verificado en S1.5 — `docs/gotchas/i18n-locale-override-zona-
//    place.md`). El namespace `navHub` se reusa para los labels del frame
//    (logout, account menu, drawer toggle — mismo widget visual que el Hub,
//    DRY).
// 6. Render `<NavPlaceLayout>` con `activeSection="language"`. Children =
//    `<LocaleSection>` (S7).
//
// `dynamic = "force-dynamic"`: el guard depende de cookie + la query
// depende de claims del request — nada SSG-cacheable. `preferredRegion =
// "iad1"` por co-location con Neon (architecture.md §Performance,
// stack.md §Región).
//
// `onLogout`: `logoutAction.bind(null, place.defaultLocale)` cierra el
// primer argumento (`locale`) del Server Action para satisfacer la firma
// `() => Promise<LogoutResult>` que pide el shell. Tras logout exitoso el
// SDK redirige al login del apex con el locale del place — coherente con
// el chrome que estaba viendo el owner.

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

type Props = {
  params: Promise<{ placeSlug: string }>;
  /**
   * `searchParams` async desde Next 15. `sso_error` (string | string[]) lo
   * emite `/api/auth/sso-redeem` (S8) en su error-redirect path: cualquier
   * fallo del pipeline (state_invalid, state_mismatch, aud_mismatch, replay,
   * signature_invalid, expired, jwks_unavailable, invalid_audience,
   * nonce_mismatch, invalid_query) redirige acá con `?sso_error=<code>`.
   * El page sólo lo consume en el branch custom-domain + sin sesión (S10).
   */
  searchParams: Promise<{ sso_error?: string | string[] }>;
};

export default async function PlaceSettingsPage({
  params,
  searchParams,
}: Props) {
  const { placeSlug } = await params;
  // (1) Gate estructural — slug servible (formato + no reservado). Antes que
  // cualquier I/O: si el slug es inválido, ningún owner real puede dueño-
  // arlo, así que es notFound() puro.
  if (!isServiceableSlug(placeSlug)) notFound();

  // (2) Host-zone (memoizado con el layout). Necesario para diferenciar el
  // branch de no-sesión en (3): redirect (subdomain canon) vs auth-gate
  // (custom-domain, S4d).
  const hostZone = await getHostZoneForZone();

  // (3) Guard sesión. `null` = no logueado en la zona. `SessionData` viene
  // con `source` (`'neon-auth' | 'sso-local'`) pero acá sólo branchemos por
  // presence/absence — el verifier ramificado vive en `getPlaceForZone` (S9).
  //   - Custom domain (S10): silent SSO trigger primero; sólo si rebotó con
  //     `?sso_error=<code>`, render del `<SsoFallbackPanel>` con CTA al
  //     subdomain canon (=plan B, ya no branch primario como en S4d Feature B).
  //   - Subdomain canon → redirect a login apex con locale del place (S4c).
  const session = await getSessionTokenForZone();
  if (session === null) {
    if (hostZone.zone === "custom-domain") {
      // Normalización de `sso_error`: Next puede entregar string o string[]
      // (param repetido en query) — tomamos el primero. Cualquier valor
      // truthy dispara el fallback panel; el code en sí lo emite el redeem
      // (S8) con un set enumerado, pero el page tolera valores arbitrarios
      // (React escapa text content automáticamente, `<code>` del panel los
      // muestra como literal para debug del owner).
      const ssoErrorRaw = (await searchParams)?.sso_error;
      const ssoError = Array.isArray(ssoErrorRaw)
        ? ssoErrorRaw[0]
        : ssoErrorRaw;
      if (ssoError) {
        // Redeem rebotó: render del fallback panel con copy localizado en el
        // `defaultLocale` configurado por el owner (resuelto en el lookup del
        // layout, S3/S4 Feature B). CTA al subdomain canon donde la cookie
        // `.place.community` sí está scopeada (= `<AuthGateForCustomDomain>`
        // del V1 ahora vive como plan B accesible vía este CTA).
        const tSso = await getTranslations({
          locale: hostZone.defaultLocale,
          namespace: "customDomainRouting.sso",
        });
        const ssoLabels: SsoFallbackLabels = {
          failureTitle: tSso("failureTitle"),
          failureBody: tSso("failureBody", { slug: hostZone.slug }),
          fallbackCta: tSso("fallbackCta", { slug: hostZone.slug }),
        };
        const canonicalUrl = buildSubdomainCanonicalUrl({
          slug: hostZone.slug,
          path: "/settings",
        });
        return (
          <SsoFallbackPanel
            canonicalUrl={canonicalUrl}
            labels={ssoLabels}
            errorCode={ssoError}
          />
        );
      }
      // Primer intento (sin error previo): disparar silent SSO server-side.
      // `redirect()` emite el response 307 nativo de Next; el owner no ve la
      // URL del init salvo que el round-trip falle (caso cubierto por el
      // branch de arriba en el reintento). El `returnTo` se URL-encodea para
      // que el `?` y `/` lleguen al handler como un único param `returnTo`.
      redirect(
        `/api/auth/sso-init?returnTo=${encodeURIComponent("/settings")}`,
      );
    }
    const fallbackLocale = await getPlaceLocaleFallback(placeSlug);
    redirect(buildApexLoginUrl({ defaultLocale: fallbackLocale }));
  }

  // (4) Carga del place. Memoizado con el layout: en este punto la query
  // ya corrió desde el `<html lang>` dinámico del layout — `getPlaceForZone`
  // retorna el resultado memoizado sin tocar Neon de nuevo.
  const place = await getPlaceForZone(placeSlug);
  if (place === null) notFound();

  // (5) i18n del settings — locale del place (DB-based, ADR-0024). Tres
  // namespaces:
  //   - `placeSettings` (dominio: title + 6 items del sidebar);
  //   - `navHub` (frame compartido: account menu + drawer toggle + logout,
  //     DRY con el Hub);
  //   - `placeSettings.language` (textos del form de la sección activa, S7).
  const tSettings = await getTranslations({
    locale: place.defaultLocale,
    namespace: "placeSettings",
  });
  const tNav = await getTranslations({
    locale: place.defaultLocale,
    namespace: "navHub",
  });
  const tLang = await getTranslations({
    locale: place.defaultLocale,
    namespace: "placeSettings.language",
  });

  // NavPlaceLabels V1.1 (ADR-0025): 4 group headers + 9 items (3 nuevos
  // V1.1: zones / groups / tiers). Las 14 labels propias del settings vienen
  // del namespace `placeSettings.sidebar.*` (paridad ×6 locales verificable
  // con `scripts/check-translations.mjs`, ADR-0024); las 5 labels del frame
  // agnóstico (drawer toggle + account menu) reusan `navHub.*` (mismo widget
  // visual que el Hub, DRY).
  const navPlaceLabels: NavPlaceLabels = {
    title: tSettings("title"),
    groupIdentity: tSettings("sidebar.groupIdentity"),
    groupStructure: tSettings("sidebar.groupStructure"),
    groupSubscription: tSettings("sidebar.groupSubscription"),
    groupManagement: tSettings("sidebar.groupManagement"),
    sidebarLanguage: tSettings("sidebar.language"),
    sidebarMembers: tSettings("sidebar.members"),
    sidebarAppearance: tSettings("sidebar.appearance"),
    sidebarHours: tSettings("sidebar.hours"),
    sidebarBilling: tSettings("sidebar.billing"),
    sidebarDomain: tSettings("sidebar.domain"),
    sidebarZones: tSettings("sidebar.zones"),
    sidebarGroups: tSettings("sidebar.groups"),
    sidebarTiers: tSettings("sidebar.tiers"),
    comingSoon: tSettings("sidebar.comingSoon"),
    openMenu: tNav("sidebarToggleOpen"),
    closeMenu: tNav("sidebarToggleClose"),
    accountMenuButton: tNav("accountMenuLabel"),
    accountMenuLogout: tNav("logout"),
    accountMenuLogoutPending: tNav("logoutConfirming"),
  };

  // Endonyms de los 6 locales (ADR-0024). El `Record<PlaceLocale, string>`
  // es tipo-cierre: si en el futuro se agrega un locale al `PLACE_LOCALES`
  // SoT pero NO al JSON i18n, este `Object.fromEntries` falla loud (key
  // `placeSettings.language.options.<nuevo>` retorna placeholder o lanza,
  // según next-intl mode). Defense-in-depth alineada con `loadPlaceBySlug`
  // que también valida el locale recibido de la DB.
  const localeOptions = Object.fromEntries(
    PLACE_LOCALES.map((loc) => [loc, tLang(`options.${loc}`)]),
  ) as Record<PlaceLocale, string>;

  const localeSectionLabels: LocaleSectionLabels = {
    title: tLang("title"),
    description: tLang("description"),
    label: tLang("label"),
    options: localeOptions,
    save: tLang("save"),
    saving: tLang("saving"),
    successTitle: tLang("successTitle"),
    successBody: tLang("successBody"),
    errorNotice: tLang("errorNotice"),
  };

  // (6) Render. `displayName=null` por ahora: la sección "Idioma" no
  // requiere identidad visible, y la query `loadPlaceBySlug` no la trae
  // (sería overhead). Si en V2 el avatar muestra iniciales reales, se
  // agrega un `userDisplayName` al payload — paralelo a `inbox` que sí lo
  // trae con la stored function.
  //
  // `<main id="contenido">` queda en el page (estructura a11y del route +
  // target del skip-link del layout S6). `<LocaleSection>` aporta su propia
  // `<section>` con header (h1 + descripción) + form — el page no duplica
  // ese header; ownership del contenido vive en el slice.
  const onLogout = logoutAction.bind(null, place.defaultLocale);

  return (
    <NavPlaceLayout
      labels={navPlaceLabels}
      displayName={null}
      activeSection="language"
      onLogout={onLogout}
    >
      <main id="contenido" className="flex flex-1 flex-col">
        <LocaleSection
          currentLocale={place.defaultLocale}
          placeSlug={place.slug}
          updateAction={updateDefaultLocaleAction}
          labels={localeSectionLabels}
        />
      </main>
    </NavPlaceLayout>
  );
}
