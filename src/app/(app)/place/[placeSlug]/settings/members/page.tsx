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
import { MembersContent } from "./_components/members-content";
import { MembersSkeleton } from "./_components/page-skeletons";

// Page del settings — sección "Miembros" (`{slug}.place.community/settings/
// members`, proxy reescribe a `/place/{slug}/settings/members`, ver
// `docs/multi-tenancy.md`). S11 del feature `members` V1 (`docs/features/
// members/spec.md` §"UI screens" S11).
//
// **Streaming agresivo del shell** (Phase 2.H.1, architecture.md
// §"Streaming agresivo del shell"): el page hace SÓLO el guard top-level
// (slug + host-zone + session + place, todos memoizados con el layout vía
// React.cache) y los labels del frame (JSON local, rápido). Renderiza el
// `<NavPlaceLayout>` (shell + sidebar) inmediato, y suspende el contenido
// pesado — el `await getAuthenticatedDbForRequest(...)` vive en
// `<MembersContent>` bajo `<Suspense fallback={<MembersSkeleton/>}>`. El
// browser pinta el shell + skeleton (~FCP inmediato) en vez de esperar la
// tx Neon. NO hay `loading.tsx` (route-level taparía el shell entero +
// doble transición — architecture.md §224).
//
// Flujo del guard:
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
// `dynamic = "force-dynamic"`: el guard depende de cookie + queries leen
// RLS owner-only — no SSG-cacheable. `preferredRegion = "iad1"` por co-
// location con Neon (architecture.md §Performance).
//
// `onLogout = logoutAction.bind(null, place.defaultLocale)`: misma técnica
// de currying que los pages hermanos.

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

type Props = {
  params: Promise<{ placeSlug: string }>;
  /** `sso_error` lo emite `/api/auth/sso-redeem` en su error-redirect path. */
  searchParams: Promise<{ sso_error?: string | string[] }>;
};

export default async function PlaceSettingsMembersPage({
  params,
  searchParams,
}: Props) {
  const { placeSlug } = await params;

  if (!isServiceableSlug(placeSlug)) notFound();

  const hostZone = await getHostZoneForZone();

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
          path: "/settings/members",
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
        `/api/auth/sso-init?returnTo=${encodeURIComponent("/settings/members")}`,
      );
    }
    const fallbackLocale = await getPlaceLocaleFallback(placeSlug);
    redirect(buildApexLoginUrl({ defaultLocale: fallbackLocale }));
  }

  const place = await getPlaceForZone(placeSlug);
  if (place === null) notFound();

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

  // `<main id="contenido">` queda en el page (estructura a11y del route +
  // target del skip-link del layout). El contenido pesado streamea bajo
  // `<Suspense>`: `<MembersContent>` hace el `await` de la tx Neon mientras
  // el skeleton ocupa el lugar.
  return (
    <NavPlaceLayout
      labels={navPlaceLabels}
      displayName={null}
      activeSection="members"
      onLogout={onLogout}
    >
      <main id="contenido" className="flex flex-1 flex-col">
        <Suspense fallback={<MembersSkeleton />}>
          <MembersContent place={place} />
        </Suspense>
      </main>
    </NavPlaceLayout>
  );
}
