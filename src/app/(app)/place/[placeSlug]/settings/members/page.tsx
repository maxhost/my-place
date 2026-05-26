import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import {
  SsoFallbackPanel,
  type SsoFallbackLabels,
} from "@/features/custom-domain-routing/public";
import {
  createInvitationAction,
  loadPendingInvitations,
  revokeInvitationAction,
} from "@/features/invitations/public";
import { loadMembers } from "@/features/members/public";
import { logoutAction } from "@/features/nav-hub/public";
import {
  NavPlaceLayout,
  type NavPlaceLabels,
} from "@/features/nav-place/public";
import {
  elevateToOwnerAction,
  revokeOwnershipAction,
  transferFounderOwnershipAction,
} from "@/features/place-ownership-actions/public";
import { removeMemberAction } from "@/features/members/public";
import {
  buildApexLoginUrl,
  buildSubdomainCanonicalUrl,
} from "@/shared/lib/auth-redirect";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";
import { isServiceableSlug } from "@/shared/lib/host-routing";

import {
  getHostZoneForZone,
  getPlaceForZone,
  getPlaceLocaleFallback,
  getSessionTokenForZone,
} from "../../_lib/get-place-for-zone";
import { MembersPageShell } from "./_components/members-page-shell";
import { buildMembersPageShellLabels } from "./_lib/build-shell-labels";

// Page del settings — sección "Miembros" (`{slug}.place.community/settings/
// members`, proxy reescribe a `/place/{slug}/settings/members`, ver
// `docs/multi-tenancy.md`). S11 del feature `members` V1 (`docs/features/
// members/spec.md` §"UI screens" S11, plan-sesiones §S11).
//
// Server Component que orquesta el seam-split del slice page-level: carga
// queries server-side bajo RLS owner-only (Feature E §"Decisión operativa")
// y delega la composición + state client-side al `<MembersPageShell />`
// (Client co-located en `./_components/`, convención ADR-0043).
//
// Espejo intencional de `settings/domain/page.tsx` (Feature custom-domain
// V1 S4 + Feature B/C S10): mismo guard pattern (slug + host-zone + session
// guard + custom-domain SSO branch + place load), mismo `<NavPlaceLayout>`
// shell. Lo único distinto es el payload de la sección.
//
// Flujo:
//   1. Gate estructural del slug (`isServiceableSlug`).
//   2. Host-zone (memoizado con el layout via React.cache).
//   3. Guard sesión cross-subdomain. Sin sesión, branchea por zona:
//      a. **Custom domain** (Feature C S10): silent SSO primero; con
//         `?sso_error=` render `<SsoFallbackPanel>` con CTA al subdomain canon.
//      b. **Subdomain canon** (Feature B S4c): redirect al login del apex
//         con locale del place via lookup anónimo.
//   4. Carga del place. `null` ⇒ no-owner por RLS / slug inexistente /
//      archivado → `notFound()`.
//   5. Carga de datos del page (members + pending invitations) + lookup
//      `app_user.id` del caller en un solo tx autenticada (`getAuthenticated
//      DbForRequest`, ADR-0034). El caller siempre es owner por (4); el
//      lookup de `app_user.id` lo resuelve la fila `app_user` filtrada por
//      `auth_user_id = claims.sub`. Si `currentAppUserId` no aparece en
//      `members` (race condition: caller fue removido entre tx y render),
//      `notFound()` — UX defensiva.
//   6. i18n DB-based: `getTranslations({locale: place.defaultLocale,
//      namespace: "placeMembers"})` resuelve ~80 keys + `placeSettings`
//      para el frame + `navHub` para el account menu.
//   7. Render `<NavPlaceLayout activeSection="members">` con `<Members
//      PageShell>` adentro. El shell inyecta el `<MemberRowActionsMenu />`
//      page-level vía render-prop a `<MembersList />` (cierra el cableado
//      iniciado en S10.9).
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

  const { members, pendingInvitations, currentAppUserId } =
    await getAuthenticatedDbForRequest(async (sql, claims) => {
      const m = await loadMembers(sql, place.id);
      const p = await loadPendingInvitations(sql, place.id);
      const cuRows = await sql(
        `SELECT id FROM app_user WHERE auth_user_id = $1`,
        [claims.sub],
      );
      const cuid = (cuRows[0]?.id as string | undefined) ?? null;
      return { members: m, pendingInvitations: p, currentAppUserId: cuid };
    });

  const callerMember = currentAppUserId
    ? members.find((mem) => mem.userId === currentAppUserId)
    : undefined;
  if (!callerMember) notFound();

  const tSettings = await getTranslations({
    locale: place.defaultLocale,
    namespace: "placeSettings",
  });
  const tNav = await getTranslations({
    locale: place.defaultLocale,
    namespace: "navHub",
  });
  const tMembers = await getTranslations({
    locale: place.defaultLocale,
    namespace: "placeMembers",
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

  const shellLabels = buildMembersPageShellLabels(tMembers);

  const onLogout = logoutAction.bind(null, place.defaultLocale);

  const inviteBaseUrl = buildSubdomainCanonicalUrl({
    slug: place.slug,
    path: "",
  }).replace(/\/$/, "");

  return (
    <NavPlaceLayout
      labels={navPlaceLabels}
      displayName={null}
      activeSection="members"
      onLogout={onLogout}
    >
      <main id="contenido" className="flex flex-1 flex-col">
        <MembersPageShell
          members={members}
          pendingInvitations={pendingInvitations}
          callerCtx={{
            userId: callerMember.userId,
            isOwner: callerMember.isOwner,
            isFounder: callerMember.isFounder,
          }}
          placeId={place.id}
          placeSlug={place.slug}
          inviteBaseUrl={inviteBaseUrl}
          actions={{
            createInvitation: createInvitationAction,
            revokeInvitation: revokeInvitationAction,
            menu: {
              elevateAction: elevateToOwnerAction,
              revokeOwnershipAction,
              removeAction: removeMemberAction,
              transferFounderAction: transferFounderOwnershipAction,
            },
          }}
          labels={shellLabels}
        />
      </main>
    </NavPlaceLayout>
  );
}
