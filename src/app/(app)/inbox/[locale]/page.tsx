import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import {
  getInboxPayload,
  type InboxLabels,
  PlacesView,
} from "@/features/inbox/public";
import {
  logoutAction,
  NavHubLayout,
  type NavHubLabels,
} from "@/features/nav-hub/public";
import { getAuthenticatedDb } from "@/shared/lib/db";
import { getSessionJwt } from "@/shared/lib/session";

// Page principal del Hub — `app.place.community/{locale}/` (proxy lo reescribe
// internamente a `/inbox/{locale}/` por route-group conflict de Next 16,
// `docs/multi-tenancy.md` + `src/proxy.ts`).
//
// Server Component que orquesta el seam-split del Hub (S5b del Hub V1,
// `docs/features/inbox/spec.md` §"Auth guard mechanism"):
//
// 1. Guard de sesión cross-subdomain: `getSessionJwt()` lee la cookie
//    `Domain=.place.community` (apex login → subdomain Hub). Sin sesión →
//    redirect al login del apex en el locale activo.
// 2. Carga i18n: namespaces `inbox` (vista) + `navHub` (shell). Mapeados al
//    contract de cada slice (`InboxLabels`/`NavHubLabels`), serializables al
//    Client.
// 3. Query autenticada: `getAuthenticatedDb(token, getInboxPayload)` arma la
//    tx con RLS (ADR-0006/0011/0021) y trae el payload de la stored function.
// 4. Render: `<NavHubLayout><PlacesView /></NavHubLayout>` — el shell sigue el
//    contract público del slice `nav-hub`; la vista, el de `inbox`.
//
// `dynamic = "force-dynamic"` obligatorio: el guard depende de cookie de
// sesión + la query depende de claims del request — nada SSG-cacheable. El
// layout sí prerendera (4 locales) gracias a `setRequestLocale` ahí; este
// page rompe explícitamente esa estaticidad.
//
// Co-location Neon ↔ Functions (`docs/architecture.md` §Performance,
// `docs/stack.md` §Región): la zona Hub es DB-bound — `iad1`.

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function InboxPage({ params }: Props) {
  const { locale } = await params;

  // (1) Guard de sesión — cookie cross-subdomain de Neon Auth. No throw: la
  // ausencia es estado válido del flujo (user no logueado en el apex).
  const token = await getSessionJwt();
  if (token === null) {
    redirect(`https://place.community/${locale}/login`);
  }

  // (2) i18n — mapeo explícito a los contracts de cada slice. Los nombres del
  // namespace JSON siguen el spec (`docs/features/inbox/spec.md` §i18n keys);
  // los del contract siguen el componente. El mapeo vive acá, en el wiring.
  const t = await getTranslations({ locale, namespace: "inbox" });
  const tNav = await getTranslations({ locale, namespace: "navHub" });

  const inboxLabels: InboxLabels = {
    viewTitle: t("viewTitle"),
    cardEnter: t("cardEnter"),
    cardSettings: t("cardSettings"),
    cardMemberSince: t("cardMemberSince"),
    statusPaymentPending: t("statusPaymentPending"),
    statusInactivationProcess: t("statusInactivationProcess"),
    statusInactive: t("statusInactive"),
    emptyTitle: t("emptyTitle"),
    emptyBody: t("emptyBody"),
    emptyCreateAction: t("emptyCreateAction"),
    emptyJoinAction: t("emptyJoinAction"),
    emptyJoinComingSoon: t("emptyJoinComingSoon"),
  };

  const navHubLabels: NavHubLabels = {
    appName: tNav("appName"),
    sidebarPlaces: tNav("sidebarPlaces"),
    sidebarMessages: tNav("sidebarMessages"),
    sidebarActivity: tNav("sidebarActivity"),
    comingSoon: tNav("sidebarComingSoon"),
    openMenu: tNav("sidebarToggleOpen"),
    closeMenu: tNav("sidebarToggleClose"),
    accountMenuButton: tNav("accountMenuLabel"),
    accountMenuLogout: tNav("logout"),
    accountMenuLogoutPending: tNav("logoutConfirming"),
  };

  // (3) Query autenticada — la RLS hace el aislamiento (el caller sólo ve sus
  // places); el wrapper convierte el JSON crudo de la function al shape TS.
  const payload = await getAuthenticatedDb(token, (executor) =>
    getInboxPayload(executor),
  );

  // (4) Render. `logoutAction.bind(null, locale)` cierra el primer argumento
  // del Server Action (`locale`) para satisfacer la firma del prop
  // `onLogout: () => Promise<LogoutResult>` del Client Component.
  const onLogout = logoutAction.bind(null, locale);

  return (
    <NavHubLayout
      labels={navHubLabels}
      displayName={payload.displayName}
      activeSection="places"
      onLogout={onLogout}
    >
      <PlacesView payload={payload} labels={inboxLabels} locale={locale} />
    </NavHubLayout>
  );
}
