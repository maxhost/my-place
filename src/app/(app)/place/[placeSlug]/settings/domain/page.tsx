import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { logoutAction } from "@/features/nav-hub/public";
import {
  NavPlaceLayout,
  type NavPlaceLabels,
} from "@/features/nav-place/public";
import {
  archiveCustomDomainAction,
  DomainSection,
  type DomainSectionLabels,
  registerCustomDomainAction,
} from "@/features/custom-domain/public";
import { getCustomDomainStatus } from "@/features/custom-domain-verification/public";
import { isServiceableSlug } from "@/shared/lib/host-routing";
import {
  getPlaceForZone,
  getSessionTokenForZone,
} from "../../_lib/get-place-for-zone";

// Page del settings — sección "Dominio" (`{slug}.place.community/settings/
// domain`, proxy reescribe a `/place/{slug}/settings/domain`, ver
// `docs/multi-tenancy.md`). S4 del feature custom-domain V1
// (`docs/features/custom-domain/spec.md` §"Cableado real (post-S4)").
//
// Server Component que orquesta el seam-split del slice
// `place-settings/domain`. Espejo intencional del page `/settings` (sección
// Idioma, S6 feature settings): mismo guard pattern, misma estructura de i18n,
// mismo `<NavPlaceLayout>` shell.
//
// Flujo:
//
// 1. Gate estructural del slug (`isServiceableSlug`) — formato/reservados.
// 2. Guard sesión cross-subdomain (`getSessionTokenForZone()` memoizado vía
//    `React.cache()`). Sin sesión → redirect al login del apex con locale `es`
//    (sin sesión no podemos saber el locale del place).
// 3. Carga del place (`getPlaceForZone(placeSlug)`, también memoizado). Si
//    `null` → no-owner por RLS / slug inexistente / archived → `notFound()`
//    (404 sin doxxear si era "no autorizado" vs "no existe").
// 4. **Lazy poll del dominio** (ADR-0026 §1, núcleo del feature):
//    `getCustomDomainStatus(place.id)` corre el SELECT de la fila activa, y
//    si está pending llama a Vercel Domains API; si Vercel confirma verified
//    persiste el `verified_at = now()` en la misma carga del page. El owner
//    que vuelve después de configurar DNS ve el estado actualizado
//    inmediatamente, sin esperar el próximo tick de un cron.
// 5. i18n DB-based: `getTranslations({locale: place.defaultLocale,
//    namespace: "placeSettings.domain"})` resuelve las ~33 keys del slice +
//    `placeSettings.sidebar.*` para el frame + `navHub.*` para el account
//    menu. Mismo patrón que el page de Idioma (S6 settings).
// 6. Render `<NavPlaceLayout>` con `activeSection="domain"` (item del
//    grupo Identidad, V1.1 ADR-0025 + activación S4 custom-domain V1).
//    Children = `<DomainSection>` con `state` (resultado del lazy poll) +
//    `registerAction` + `archiveAction` inyectadas (seam-split).
//
// `dynamic = "force-dynamic"`: el lazy poll requiere no-cache; SSG/ISR
// rompería el contrato de "ver el estado actualizado sin esperar tick".
// `preferredRegion = "iad1"` por co-location con Neon (architecture.md
// §Performance).
//
// `onLogout = logoutAction.bind(null, place.defaultLocale)`: misma técnica
// de currying que el page de Idioma — cierra el primer arg (locale) del
// Server Action para satisfacer la firma `() => Promise<LogoutResult>` que
// pide el shell.

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

type Props = {
  params: Promise<{ placeSlug: string }>;
};

export default async function PlaceSettingsDomainPage({ params }: Props) {
  const { placeSlug } = await params;

  // (1) Gate estructural — slug servible antes de cualquier I/O.
  if (!isServiceableSlug(placeSlug)) notFound();

  // (2) Guard sesión cross-subdomain.
  const token = await getSessionTokenForZone();
  if (token === null) {
    redirect("https://place.community/es/login");
  }

  // (3) Carga del place (memoizada con el layout vía React.cache).
  const place = await getPlaceForZone(placeSlug);
  if (place === null) notFound();

  // (4) Lazy poll del custom domain. Atómica desde el punto de vista del
  // page: una invocación resuelve SELECT + (potencial) GET Vercel +
  // (potencial) UPDATE verified_at. Failure modes (DB error, Vercel down)
  // colapsan a `{status: "none"}` o `{status: "pending", vercelUnavailable:
  // true}` — la UI muestra copy calmo en cada caso, el page nunca tira.
  const state = await getCustomDomainStatus(place.id);

  // (5) i18n del settings — locale del place (DB-based, ADR-0024). Tres
  // namespaces:
  //   - `placeSettings` (sidebar + title del shell);
  //   - `navHub` (account menu + drawer toggle, DRY con el Hub);
  //   - `placeSettings.domain` (~33 keys del form/states/errores del slice).
  const tSettings = await getTranslations({
    locale: place.defaultLocale,
    namespace: "placeSettings",
  });
  const tNav = await getTranslations({
    locale: place.defaultLocale,
    namespace: "navHub",
  });
  const tDomain = await getTranslations({
    locale: place.defaultLocale,
    namespace: "placeSettings.domain",
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

  // ~33 labels del slice serializadas para el Client. La paridad ×6 locales
  // del bloque `placeSettings.domain.*` se valida con `scripts/check-
  // translations.mjs` (ADR-0024). Si en V2 se agrega una key acá, hay que
  // actualizar los 6 JSONs y `DomainSectionLabels` en simultáneo —
  // typecheck + check-translations atrapan ambos lados.
  const domainSectionLabels: DomainSectionLabels = {
    title: tDomain("title"),
    description: tDomain("description"),
    inputLabel: tDomain("inputLabel"),
    inputPlaceholder: tDomain("inputPlaceholder"),
    submitButton: tDomain("submitButton"),
    submitting: tDomain("submitting"),
    pendingTitle: tDomain("pendingTitle"),
    pendingDescription: tDomain("pendingDescription"),
    downrevertedBannerTitle: tDomain("downrevertedBannerTitle"),
    downrevertedBannerBody: tDomain("downrevertedBannerBody"),
    pendingSlaCopy: tDomain("pendingSlaCopy"),
    pendingVercelUnavailable: tDomain("pendingVercelUnavailable"),
    dnsRecordsTitle: tDomain("dnsRecordsTitle"),
    dnsRecordType: tDomain("dnsRecordType"),
    dnsRecordName: tDomain("dnsRecordName"),
    dnsRecordValue: tDomain("dnsRecordValue"),
    copyButton: tDomain("copyButton"),
    copiedTooltip: tDomain("copiedTooltip"),
    verifiedBadge: tDomain("verifiedBadge"),
    verifiedDescription: tDomain("verifiedDescription"),
    archiveButton: tDomain("archiveButton"),
    archiveConfirmTitle: tDomain("archiveConfirmTitle"),
    archiveConfirmBody: tDomain("archiveConfirmBody"),
    archiveConfirmYes: tDomain("archiveConfirmYes"),
    archiveConfirmNo: tDomain("archiveConfirmNo"),
    archiving: tDomain("archiving"),
    errorInvalidDomain: tDomain("errorInvalidDomain"),
    errorReserved: tDomain("errorReserved"),
    errorIdnNotSupported: tDomain("errorIdnNotSupported"),
    errorDomainTaken: tDomain("errorDomainTaken"),
    errorLimitReached: tDomain("errorLimitReached"),
    errorVercelUnavailable: tDomain("errorVercelUnavailable"),
    errorGeneric: tDomain("errorGeneric"),
    errorArchiveNotFound: tDomain("errorArchiveNotFound"),
    errorArchiveGeneric: tDomain("errorArchiveGeneric"),
  };

  const onLogout = logoutAction.bind(null, place.defaultLocale);

  // `<main id="contenido">` queda en el page (estructura a11y del route +
  // target del skip-link del layout). `<DomainSection>` aporta su propia
  // `<section>` con header (h1 + descripción) + 3 estados — el page no
  // duplica ese header; ownership del contenido vive en el slice.
  return (
    <NavPlaceLayout
      labels={navPlaceLabels}
      displayName={null}
      activeSection="domain"
      onLogout={onLogout}
    >
      <main id="contenido" className="flex flex-1 flex-col">
        <DomainSection
          state={state}
          placeSlug={place.slug}
          registerAction={registerCustomDomainAction}
          archiveAction={archiveCustomDomainAction}
          labels={domainSectionLabels}
        />
      </main>
    </NavPlaceLayout>
  );
}
