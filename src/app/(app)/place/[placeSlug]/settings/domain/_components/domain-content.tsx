import { getTranslations } from "next-intl/server";

import {
  archiveCustomDomainAction,
  DomainSection,
  type DomainSectionLabels,
  registerCustomDomainAction,
} from "@/features/custom-domain/public";
import { getCustomDomainStatus } from "@/features/custom-domain-verification/public";
import type { PlaceData } from "@/features/place/public";

// Async Server Component del contenido de `/settings/domain` (Phase 2.H.1,
// extraído del `page.tsx` para streaming agresivo del shell, architecture.md
// §"Streaming agresivo del shell"). El `page.tsx` valida + pinta el shell, y
// suspende ESTE child mientras corre el lazy poll del dominio — el await más
// lento de los settings.
//
// **Lazy poll del dominio** (ADR-0026 §1, núcleo del feature):
// `getCustomDomainStatus(place.id)` corre el SELECT de la fila activa y, si
// está pending, llama a la Vercel Domains API; si Vercel confirma verified
// persiste `verified_at = now()` en la misma carga. El owner que vuelve tras
// configurar DNS ve el estado actualizado al instante, sin esperar un cron.
// Failure modes (DB error, Vercel down) colapsan a `{status:"none"}` o
// `{status:"pending", vercelUnavailable:true}` — la UI muestra copy calmo en
// cada caso, el child nunca tira.

export async function DomainContent({ place }: { place: PlaceData }) {
  const state = await getCustomDomainStatus(place.id);

  // i18n del slice — locale del place (DB-based, ADR-0024). ~33 keys del
  // namespace `placeSettings.domain` (paridad ×6 locales validada por
  // `scripts/check-translations.mjs`).
  const tDomain = await getTranslations({
    locale: place.defaultLocale,
    namespace: "placeSettings.domain",
  });

  const domainSectionLabels: DomainSectionLabels = {
    title: tDomain("title"),
    description: tDomain("description"),
    descriptionVerified: tDomain("descriptionVerified"),
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
    errorRateLimited: tDomain("errorRateLimited"),
    errorGeneric: tDomain("errorGeneric"),
    errorArchiveNotFound: tDomain("errorArchiveNotFound"),
    errorArchiveGeneric: tDomain("errorArchiveGeneric"),
  };

  return (
    <DomainSection
      state={state}
      placeSlug={place.slug}
      registerAction={registerCustomDomainAction}
      archiveAction={archiveCustomDomainAction}
      labels={domainSectionLabels}
    />
  );
}
