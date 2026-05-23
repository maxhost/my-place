// Interfaz pública del slice `custom-domain-routing` (Feature B V1, ADR-0031).
// Paradigma vertical-slice (`docs/architecture.md` §17-25): los consumers —
// pages owner-only del settings (`(app)/place/[placeSlug]/settings/*`) cuando
// el host es custom-domain Y no hay sesión — importan SÓLO desde acá, nunca
// de internals.
//
// El slice encapsula la "gate page" educativa que SUSTITUYE el redirect
// al login del apex cuando el visitor está en un custom-domain: la cookie
// Neon Auth `Domain=.place.community` NO acompaña a `nocodecompany.co`, así
// que un redirect ciego sería un loop educativo (apex se autentica, vuelve
// a custom-domain como visitor sin cookie, redirect otra vez). Feature C
// (OIDC SSO) cierra el gap; V1 acepta el límite con UX explícita.
//
// COMPONENTES PÚBLICOS:
//
//   - `<AuthGateForCustomDomain>` — Server Component presentacional con
//     props `{canonicalUrl, labels}`. El page consume `getTranslations`
//     (`customDomainRouting.authGate.*` — paridad ×6 locales enforced por
//     `scripts/check-translations.mjs`, S5) y pre-computa `canonicalUrl` via
//     `buildSubdomainCanonicalUrl` de `@/shared/lib/auth-redirect` (S4c).
//     El slice queda agnóstico de next-intl y del helper de URLs, alineado
//     con el patrón canon de `LocaleSection` / `DomainSection`.
//   - `AuthGateLabels` — shape de los 4 labels (`title`, `body`, `cta`,
//     `help`). El cambio de copy en V2 actualiza i18n + esta interfaz +
//     typecheck atrapa drift.
//
// CONSUMERS V1:
//   - `src/app/(app)/place/[placeSlug]/settings/page.tsx` — auth gate cuando
//     `hostZone.zone === "custom-domain"` Y `token === null`.
//   - `src/app/(app)/place/[placeSlug]/settings/domain/page.tsx` — idem.
//
// Lo que NO se exporta acá (intencional):
//   - El parser interno `renderBoldSegments` — detalle de presentación; el
//     test del componente lo valida por output renderizado, no por API.
//   - Helpers de host detection — el page los obtiene de
//     `shared/lib/host-routing` (`resolveHostWithCustomDomains`) y el wiring
//     memoizado vive en `_lib/get-place-for-zone.ts` (mismo árbol de
//     route, helper de zona — no es dominio del slice).

export {
  AuthGateForCustomDomain,
  type AuthGateLabels,
} from "./ui/auth-gate";
