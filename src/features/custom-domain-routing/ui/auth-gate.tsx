import type { ReactNode } from "react";

// Feature B — custom-domain-routing V1 · S4d (ADR-0031 §"Auth gate UX",
// 2026-05-22).
//
// Server Component presentacional puro para la "gate page" del owner sin
// sesión que aterriza en un custom domain (`nocodecompany.co/settings` cuando
// la cookie Neon Auth `Domain=.place.community` NO acompaña — limitación V1
// que cierra Feature C OIDC).
//
// ## Por qué no redirect ciego
//
// Pre-S4d, el page del settings hubiera hecho `redirect(buildApexLoginUrl(...))`
// en cualquier zona sin sesión. Pero en custom domain el redirect causaría un
// LOOP educativo: el owner aterriza en `place.community/{locale}/login`,
// se autentica → cookie se setea para `.place.community` → vuelve al custom
// domain como visitor sin cookie (otro origin) → redirect otra vez. Sin OIDC
// (Feature C), no hay forma técnica de evitar el loop. La gate page lo
// SUSTITUYE explicando al owner que necesita administrar desde el subdomain
// canónico, con un botón directo a `{slug}.place.community{returnPath}`.
//
// ## Contrato del componente
//
// Recibe LABELS ya resueltas por el page (mismo patrón canónico que
// `LocaleSection` / `DomainSection`: el page consume `getTranslations` y pasa
// los strings finales — el slice queda agnóstico de next-intl). El page
// también pre-computa `canonicalUrl` via `buildSubdomainCanonicalUrl` (S4c) —
// el slice no importa `shared/lib/auth-redirect`, mantiene aislamiento del
// paradigma vertical-slice.
//
// ## Body con `**bold**` markdown
//
// El template canónico del i18n (`customDomainRouting.authGate.body` ×6
// locales, S5 commit `6c7555f`) tiene `**{slug}**` para enfatizar visualmente
// el nombre del place. El page resuelve `{slug}` via interpolación de
// next-intl; el componente parsea los segmentos `**...**` a `<strong>` con un
// split-on-regex (patrón análogo a `features/access/ui/access-flow.tsx:56`
// para los placeholders de Terms+Privacy).
//
// Defense-in-depth del parser:
//   - `**` no balanceado → segmento queda como texto literal (fail-soft).
//   - Sin `**` → split retorna un solo elemento, render plano (no
//     `<strong>`).
//   - Múltiples segmentos → cada uno renderizado independiente con su key.
//
// ## Seguridad del link
//
// `rel="noopener"` por defense-in-depth: el subdomain canon es del mismo
// producto (no terceros) pero técnicamente es cross-origin desde un custom
// domain — el atacante teórico que tomó control de `place.community` no debe
// poder manipular el `window.opener` del custom domain del owner. Es belt+
// suspenders; no `noreferrer` porque queremos preservar Referer para
// observabilidad legítima cross-subdomain de la red de places.

export interface AuthGateLabels {
  /** Heading principal (h1). i18n key `customDomainRouting.authGate.title`. */
  title: string;
  /**
   * Copy descriptivo. Soporta segmentos `**bold**` parseados a `<strong>`.
   * i18n key `customDomainRouting.authGate.body` (con `{slug}` ya resuelto
   * por el page).
   */
  body: string;
  /**
   * Texto del botón/link. i18n key `customDomainRouting.authGate.cta` (con
   * `{slug}` ya resuelto por el page).
   */
  cta: string;
  /**
   * Copy auxiliar (tranquiliza al owner: el dominio sigue funcionando para
   * visitantes). i18n key `customDomainRouting.authGate.help`.
   */
  help: string;
}

interface Props {
  /**
   * URL absoluta del subdomain canónico (`{scheme}://{slug}.{rootDomain}
   * {returnPath}`), pre-computada por el page via
   * `buildSubdomainCanonicalUrl` de `shared/lib/auth-redirect` (S4c).
   */
  canonicalUrl: string;
  labels: AuthGateLabels;
}

/**
 * Parsea texto con `**bold**` segments a una lista de ReactNodes.
 *
 * Comportamiento:
 *   - `"texto **X** plano"` → `["texto ", <strong>X</strong>, " plano"]`
 *   - `"plano"` → `["plano"]`
 *   - `"texto ** sin cerrar"` → `["texto ** sin cerrar"]` (fail-soft).
 *
 * El regex usa lookahead-free `\*\*([^*]+)\*\*` que NO matchea `**` aislado
 * (sin cierre) — el split deja el segmento como texto literal.
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

export function AuthGateForCustomDomain({
  canonicalUrl,
  labels,
}: Props): React.JSX.Element {
  return (
    <section className="mx-auto flex w-full max-w-[32rem] flex-col gap-6 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl text-ink">{labels.title}</h1>
      </header>
      <p className="text-base text-muted leading-relaxed">
        {renderBoldSegments(labels.body)}
      </p>
      <a
        href={canonicalUrl}
        rel="noopener"
        className="inline-flex w-fit items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {labels.cta}
      </a>
      <p className="text-sm text-muted">{labels.help}</p>
    </section>
  );
}
