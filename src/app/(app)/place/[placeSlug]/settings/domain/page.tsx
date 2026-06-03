import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import {
  SsoFallbackPanel,
  type SsoFallbackLabels,
} from "@/features/custom-domain-routing/public";
import { logoutAction } from "@/features/nav-hub/public";
import {
  NavPlaceLayout,
  type NavPlaceLabels,
} from "@/features/nav-place/public";
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
} from "../../_lib/get-place-for-zone";
import { DomainContent } from "./_components/domain-content";
import { DomainSkeleton } from "./_components/page-skeletons";

// Page del settings — sección "Dominio" (`{slug}.place.community/settings/
// domain`, proxy reescribe a `/place/{slug}/settings/domain`, ver
// `docs/multi-tenancy.md`). S4 del feature custom-domain V1
// (`docs/features/custom-domain/spec.md` §"Cableado real (post-S4)").
//
// **Streaming agresivo del shell** (Phase 2.H.1, architecture.md
// §"Streaming agresivo del shell"): el page hace SÓLO el guard top-level
// (slug + host-zone + session + place, memoizados con el layout) + labels
// del frame, renderiza el `<NavPlaceLayout>` inmediato, y suspende el
// contenido — el lazy poll del dominio (`getCustomDomainStatus`, SELECT +
// posible round-trip a Vercel) vive en `<DomainContent>` bajo `<Suspense
// fallback={<DomainSkeleton/>}>`. Es el await más lento de los settings →
// la mejora de FCP más visible. NO hay `loading.tsx` (route-level taparía
// el shell entero + doble transición — architecture.md §224).
//
// Flujo del guard (espejo de `settings/page.tsx` y `members/page.tsx`):
//   1. Gate estructural del slug (`isServiceableSlug`).
//   2. Host-zone (memoizado con el layout via React.cache).
//   3. Guard sesión cross-subdomain. Sin sesión, branchea por zona:
//      a. **Custom domain** (Feature C S10): silent SSO primero; con
//         `?sso_error=` render `<SsoFallbackPanel>` con CTA al subdomain canon.
//      b. **Subdomain canon** (Feature B S4c): redirect al login del apex
//         con locale del place via lookup anónimo.
//   4. Carga del place. `null` ⇒ no-owner por RLS / slug inexistente /
//      archivado → `notFound()`.
//
// `dynamic = "force-dynamic"`: el lazy poll requiere no-cache; SSG/ISR
// rompería el contrato de "ver el estado actualizado sin esperar tick".
// `preferredRegion = "iad1"` por co-location con Neon (architecture.md
// §Performance).

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

type Props = {
  params: Promise<{ placeSlug: string }>;
  /** `sso_error` lo emite `/api/auth/sso-redeem` en su error-redirect path. */
  searchParams: Promise<{ sso_error?: string | string[] }>;
};

export default async function PlaceSettingsDomainPage({
  params,
  searchParams,
}: Props) {
  const { placeSlug } = await params;

  // (1) Gate estructural — slug servible antes de cualquier I/O.
  if (!isServiceableSlug(placeSlug)) notFound();

  // (2) Host-zone (memoizado con el layout). Branch del guard en (3).
  const hostZone = await getHostZoneForZone();

  // (3) Guard sesión cross-subdomain. `null` = no logueado en la zona.
  const session = await getSessionTokenForZone();
  if (session === null) {
    if (hostZone.zone === "custom-domain") {
      const ssoErrorRaw = (await searchParams)?.sso_error;
      const ssoError = Array.isArray(ssoErrorRaw)
        ? ssoErrorRaw[0]
        : ssoErrorRaw;
      if (ssoError) {
        const tSso = await getTranslations({
          locale: hostZone.defaultLocale,
          namespace: "customDomainRouting.sso",
        });
        const ssoLabels: SsoFallbackLabels = {
          failureTitle: tSso("failureTitle"),
          failureBody: tSso("failureBody", { slug: hostZone.slug }),
          fallbackCta: tSso("fallbackCta", { slug: hostZone.slug }),
          technicalDetails: tSso("technicalDetails"),
        };
        const canonicalUrl = buildSubdomainCanonicalUrl({
          slug: hostZone.slug,
          path: "/settings/domain",
        });
        return (
          <SsoFallbackPanel
            canonicalUrl={canonicalUrl}
            labels={ssoLabels}
            errorCode={ssoError}
          />
        );
      }
      redirect(
        `/api/auth/sso-init?returnTo=${encodeURIComponent("/settings/domain")}`,
      );
    }
    const fallbackLocale = await getPlaceLocaleFallback(placeSlug);
    redirect(buildApexLoginUrl({ defaultLocale: fallbackLocale }));
  }

  // (4) Carga del place (memoizada con el layout vía React.cache).
  const place = await getPlaceForZone(placeSlug);
  if (place === null) notFound();

  // (5) i18n del frame — locale del place (DB-based, ADR-0024). Dos
  // namespaces para el shell: `placeSettings` (sidebar + title) y `navHub`
  // (account menu + drawer toggle, DRY con el Hub). El i18n del slice
  // (`placeSettings.domain`) se resuelve adentro de `<DomainContent>`.
  const tSettings = await getTranslations({
    locale: place.defaultLocale,
    namespace: "placeSettings",
  });
  const tNav = await getTranslations({
    locale: place.defaultLocale,
    namespace: "navHub",
  });

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

  const onLogout = logoutAction.bind(null, place.defaultLocale);

  // `<main id="contenido">` queda en el page (estructura a11y + skip-link
  // target). El contenido pesado streamea bajo `<Suspense>`:
  // `<DomainContent>` hace el lazy poll mientras el skeleton ocupa el lugar.
  return (
    <NavPlaceLayout
      labels={navPlaceLabels}
      displayName={null}
      activeSection="domain"
      onLogout={onLogout}
    >
      <main id="contenido" className="flex flex-1 flex-col">
        <Suspense fallback={<DomainSkeleton />}>
          <DomainContent place={place} />
        </Suspense>
      </main>
    </NavPlaceLayout>
  );
}
