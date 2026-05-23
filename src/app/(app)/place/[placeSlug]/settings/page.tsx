import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import {
  AuthGateForCustomDomain,
  type AuthGateLabels,
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
// + Feature B S4d (ADR-0031 §"Auth gate UX", 2026-05-22).
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
//      a. **Custom domain** (Feature B S4d): la cookie Neon Auth
//         `Domain=.place.community` NO acompaña al custom host (V1 gap,
//         Feature C OIDC cierra). Un redirect ciego al apex login causaría
//         loop: owner aterriza en apex, autentica, vuelve al custom domain
//         como visitor sin cookie. SUSTITUIR redirect por `<AuthGateForCustomDomain>`
//         con copy localizado (`customDomainRouting.authGate.*` ×6 locales,
//         S5) + link directo al subdomain canon (`buildSubdomainCanonicalUrl`,
//         S4c) donde la cookie sí está scopeada.
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
};

export default async function PlaceSettingsPage({ params }: Props) {
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
  //   - Custom domain → auth-gate localizado (S4d V1, S10 lo evoluciona a
  //     silent SSO trigger), NO redirect (loop trap).
  //   - Subdomain canon → redirect a login apex con locale del place (S4c).
  const session = await getSessionTokenForZone();
  if (session === null) {
    if (hostZone.zone === "custom-domain") {
      // Render `<AuthGateForCustomDomain>` con copy localizado en el
      // `defaultLocale` configurado por el owner (resuelto en el lookup
      // del proxy/layout, S1/S3). Link directo al subdomain canon donde la
      // cookie `.place.community` sí está scopeada.
      const tGate = await getTranslations({
        locale: hostZone.defaultLocale,
        namespace: "customDomainRouting.authGate",
      });
      const gateLabels: AuthGateLabels = {
        title: tGate("title"),
        body: tGate("body", { slug: hostZone.slug }),
        cta: tGate("cta", { slug: hostZone.slug }),
        help: tGate("help"),
      };
      const canonicalUrl = buildSubdomainCanonicalUrl({
        slug: hostZone.slug,
        path: "/settings",
      });
      return (
        <AuthGateForCustomDomain
          canonicalUrl={canonicalUrl}
          labels={gateLabels}
        />
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
