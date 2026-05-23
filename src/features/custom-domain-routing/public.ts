// Interfaz pública del slice `custom-domain-routing` (Feature B V1 ADR-0031,
// expandido por Feature C S6 ADR-0032). Paradigma vertical-slice
// (`docs/architecture.md` §17-25): los consumers — pages owner-only del
// settings (`(app)/place/[placeSlug]/settings/*`) cuando el host es
// custom-domain — importan SÓLO desde acá, nunca de internals.
//
// El slice encapsula DOS componentes presentacionales para el branch
// "owner sin sesión local en custom-domain":
//
//   1. `<AuthGateForCustomDomain>` (Feature B-S4d) — gate educativa V1
//      cuando todavía NO había SSO. Loop sin Feature C: apex se autentica
//      → cookie `.place.community` que NO acompaña al custom domain.
//   2. `<SsoFallbackPanel>` (Feature C-S6) — UI de error cuando el silent
//      SSO falla (`?sso_error=<code>` en query). PRIMARIO post-Feature-C:
//      el page intenta redirect a `/api/auth/sso-init` primero; este
//      panel sólo aparece cuando el redeem rebotó.
//
// Ambos comparten el patrón: page consume `getTranslations` + pre-computa
// `canonicalUrl` via `buildSubdomainCanonicalUrl` de `@/shared/lib/auth-
// redirect` (S4c) → el slice queda agnóstico de next-intl y de helpers de
// URL. Alineado con el patrón canon de `LocaleSection` / `DomainSection`.
//
// COMPONENTES PÚBLICOS:
//
//   - `<AuthGateForCustomDomain>` + `AuthGateLabels` — props
//     `{canonicalUrl, labels}`. i18n namespace `customDomainRouting.authGate.*`
//     (×6 locales, S5 Feature B).
//   - `<SsoFallbackPanel>` + `SsoFallbackLabels` — props `{canonicalUrl,
//     labels, errorCode?}`. i18n namespace `customDomainRouting.sso.*` (×6
//     locales, S6 Feature C). `errorCode` opcional dentro de `<details>`
//     para debug del owner sin contaminar UX principal.
//
// CONSUMERS V1:
//   - `src/app/(app)/place/[placeSlug]/settings/page.tsx` — ramifica zona +
//     query string `sso_error` (S10 Feature C).
//   - `src/app/(app)/place/[placeSlug]/settings/domain/page.tsx` — idem.
//
// Lo que NO se exporta acá (intencional):
//   - El parser interno `renderBoldSegments` — detalle de presentación;
//     duplicado en `auth-gate.tsx` y `sso-fallback-panel.tsx` (regla del 3:
//     extraer cuando aparezca el tercer caller). Los tests del componente
//     validan por output renderizado, no por API.
//   - Helpers de host detection — el page los obtiene de
//     `shared/lib/host-routing` (`resolveHostWithCustomDomains`) y el wiring
//     memoizado vive en `_lib/get-place-for-zone.ts`.

export {
  AuthGateForCustomDomain,
  type AuthGateLabels,
} from "./ui/auth-gate";

export {
  SsoFallbackPanel,
  type SsoFallbackLabels,
} from "./ui/sso-fallback-panel";
