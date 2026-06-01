import type { ReactNode } from "react";

// Feature C — custom-domain-routing · S6 (ADR-0032 §"UI fallback panel",
// 2026-05-23).
//
// Server Component presentacional puro para la UI de error cuando el silent
// SSO falla (init/issue/redeem retorna `?sso_error=<code>`). Reemplaza el
// `<AuthGateForCustomDomain>` (Feature B-S4d) como branch sin-sesión PRIMARIO
// del settings en custom domain: en Feature C el primer intento es silent
// SSO redirect (server-side `/api/auth/sso-init`); este panel sólo aparece
// cuando el redeem rebotó con error.
//
// ## Cuándo se renderiza
//
// `settings/page.tsx` (S10) ramifica:
//   - host = custom-domain + sin `?sso_error=` → `redirect('/api/auth/sso-init')`
//     (silent SSO).
//   - host = custom-domain + `?sso_error=<code>` → render `<SsoFallbackPanel>`
//     con `errorCode={code}`.
//   - host = custom-domain + sesión SSO local OK → render settings normal.
//
// El `<AuthGateForCustomDomain>` original queda accesible via el CTA "Ir a
// {slug} en place.community" del panel — mismo destino (URL canónica del
// subdomain), pero ahora es el plan B después del intento automático, no el
// branch primario.
//
// ## Contrato del componente
//
// Idéntico al pattern `<AuthGateForCustomDomain>`: recibe LABELS ya resueltas
// por el page (mismo paradigma "el slice queda agnóstico de next-intl"), más
// `canonicalUrl` pre-computada con `buildSubdomainCanonicalUrl` (S4c Feature
// B). El page consume el namespace `customDomainRouting.sso.*` (paridad × 6
// locales enforced por `scripts/check-translations.mjs`).
//
// `errorCode` es OPCIONAL — se pasa solo cuando el query string trae
// `?sso_error=<code>`. Si presente, se renderiza dentro de un `<details>`
// colapsado para debug del owner sin contaminar la UX principal. Códigos
// canónicos del flow (S8): `state_invalid`, `state_mismatch`, `state_expired`,
// `aud_mismatch`, `signature_invalid`, `expired`, `replay`,
// `jwks_unavailable`, `invalid_audience`, `nonce_mismatch`.
//
// ## Body con `**bold**` markdown
//
// Mismo parser que `auth-gate.tsx`: split-on-regex `(\\*\\*[^*]+\\*\\*)` con
// fail-soft a texto literal si los `**` no están balanceados. **V1 duplica
// el helper `renderBoldSegments`** intencionalmente (regla del 3: extraer a
// `lib/render-bold-segments.ts` cuando aparezca el tercer caller). Duplicación
// declarada en ADR-0032 §"Organización".
//
// ## Seguridad del link
//
// `rel="noopener"` por defense-in-depth idéntico al auth-gate (cross-origin
// custom-domain → subdomain canon). No `noreferrer` — Referer útil para
// observabilidad cross-subdomain legítima del Place network.
//
// ## errorCode escaping
//
// React escapa text content automáticamente. El `errorCode` viene del query
// string (`?sso_error=...`) — aunque S8 sólo emite códigos enumerados,
// inyectar `errorCode` como texto plano dentro de `<code>` cubre cualquier
// futuro path donde un valor arbitrario llegue acá. Sin `dangerouslySetInnerHTML`.

export interface SsoFallbackLabels {
  /**
   * Heading principal (h1). i18n key `customDomainRouting.sso.failureTitle`.
   * Copy canónico: "No pudimos iniciarte sesión automáticamente".
   */
  failureTitle: string;
  /**
   * Copy descriptivo del fallo. Soporta segmentos `**bold**` parseados a
   * `<strong>`. i18n key `customDomainRouting.sso.failureBody` (con `{slug}`
   * ya resuelto por el page).
   */
  failureBody: string;
  /**
   * Texto del botón/link al subdomain canónico. i18n key
   * `customDomainRouting.sso.fallbackCta` (con `{slug}` ya resuelto).
   */
  fallbackCta: string;
  /**
   * Etiqueta del `<summary>` que colapsa el `errorCode` para debug del owner.
   * i18n key `customDomainRouting.sso.technicalDetails` (Phase 2.G). El
   * `errorCode` en sí NO se traduce (identificador estable del protocolo SSO).
   */
  technicalDetails: string;
}

interface Props {
  /**
   * URL absoluta del subdomain canónico (`{scheme}://{slug}.{rootDomain}
   * {returnPath}`), pre-computada por el page via
   * `buildSubdomainCanonicalUrl` de `shared/lib/auth-redirect` (S4c
   * Feature B).
   */
  canonicalUrl: string;
  labels: SsoFallbackLabels;
  /**
   * Código de error opcional del query string `?sso_error=<code>`. Si está
   * presente, se renderiza dentro de un `<details>` colapsado. Útil para
   * debug del owner; no se traduce porque es un identificador estable del
   * protocolo SSO (S8 emite códigos enumerados en inglés/snake_case).
   */
  errorCode?: string;
}

/**
 * Parsea texto con `**bold**` segments a una lista de ReactNodes. Duplicado
 * de `auth-gate.tsx:97` (regla del 3: extraer a helper compartido cuando
 * aparezca el tercer caller). Mismo comportamiento fail-soft.
 */
function renderBoldSegments(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

export function SsoFallbackPanel({
  canonicalUrl,
  labels,
  errorCode,
}: Props): React.JSX.Element {
  return (
    <section className="mx-auto flex w-full max-w-[32rem] flex-col gap-6 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl text-ink">{labels.failureTitle}</h1>
      </header>
      <p className="text-base text-muted leading-relaxed">
        {renderBoldSegments(labels.failureBody)}
      </p>
      <a
        href={canonicalUrl}
        rel="noopener"
        className="cta inline-flex w-fit items-center justify-center rounded-md px-5 py-2.5 text-sm font-medium"
      >
        {labels.fallbackCta}
      </a>
      {errorCode ? (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer select-none">{labels.technicalDetails}</summary>
          <code className="mt-2 block break-all rounded bg-muted/10 px-2 py-1">
            {errorCode}
          </code>
        </details>
      ) : null}
    </section>
  );
}
