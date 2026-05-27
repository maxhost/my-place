// Feature E — Invite Accept Flow V1.2 · Sesión D fix (ADR-0046 §"Addendum
// operacional — Sesión D", 2026-05-26).
//
// ## Por qué este helper existe
//
// Resuelve un bug E2E descubierto durante smoke matriz 2x2: post-credential
// en `/login?invite={token}`, el guard del page (`(marketing)/[locale]/login/
// page.tsx`) era invocado durante el Next.js Server Action auto-revalidate
// (`x-action-revalidated: 1` confirmado en HAR), disparaba `redirect()`
// server-side hacia Hub usando solo `safeReturnTo` (ignorando `inviteContext`),
// y **override** la navegación client-side de `AccessFlow.onSuccess` hacia
// `postCredentialUrl`. El browser abortaba ambas (POST response + sso-init
// nav, `net::ERR_ABORTED` en HAR) y aterrizaba en el Hub default.
//
// Detalle del race + gotcha pattern para futuras Server Actions authed con
// AccessFlow: `docs/gotchas/server-action-revalidation-overrides-client-
// navigation.md`.
//
// ## Fix arquitectónico (no parche)
//
// Single source of truth del orden de prioridad post-credential, compartido
// entre los 2 callers que resuelven destino:
//   - **`AccessFlow.onSuccess`** (client-side, post-form-submit happy path).
//   - **`/login/page.tsx` guard** (server-side, post-revalidation OR pre-
//     render-with-session ya activa).
//
// Pre-fix, ambos duplicaban el `??` chain — el guard server omitía
// `inviteContext`, AccessFlow client lo honraba. Post-fix, ambos consumen
// este helper. Una sola definición de prioridad → imposible que diverjan.
//
// ## Orden de prioridad (canon)
//
// 1. **`inviteContext.postCredentialUrl`** — si presente (invite flow activo
//    via `?invite={token}`), gana sobre todo. URL ya construida server-side
//    via `buildSsoInitUrlForInvite` (custom domain → sso-init silent SSO chain;
//    subdomain canon → direct invite URL, ADR-0046 §D4).
// 2. **`returnTo`** — si presente (cold-start SSO M1, ADR-0033), URL ya
//    validada por `validateLoginReturnTo` (allowlist canon: sso-issue/sso-init
//    same-registrable-domain HTTPS + relative paths matching `/invite/[token]`).
// 3. **`hubFallback`** — Hub canónico del locale (caller construye:
//    `https://app.${rootDomain()}/${locale}/`). Comportamiento backwards-
//    compat pre-V1.1 para signup desde landing, login directo sin params.
//
// ## Por qué PURE (sin construir hubFallback internamente)
//
// El helper NO acepta `locale` ni computa el Hub URL internamente. Razón:
// mantenerlo PURE + agnóstico de `rootDomain()` lookup + i18n. El caller
// construye su Hub URL (típicamente `https://app.${rootDomain()}/${locale}/`)
// y lo pasa como `hubFallback` requerido. Esto permite que el helper sea unit-
// testeable sin mocks de `process.env` ni `next-intl` — paralelo al ethos de
// `auth-redirect.ts` (PURE helpers de URL composition).
//
// ## Defensive typing (`null | undefined`)
//
// `inviteContext` y `returnTo` aceptan `null` o `undefined` por paridad con
// los retornos canon de sus productores:
//   - `validateLoginReturnTo` retorna `string | null` (null = rechazado).
//   - `lookupInvitationPreview` retorna `null` cuando el token shape gate
//     falla o el DEFINER no encuentra (anti-info-leak).
//   - Prop `inviteContext` de `<AccessFlow>` es `undefined` cuando ausente.
//
// El operador `??` colapsa null Y undefined al fallback. Empty string NO
// colapsa (matches `AccessFlow.onSuccess` pre-fix behavior; en producción
// `buildSsoInitUrlForInvite` nunca emite empty string por contrato).
//
// ## Estructural sobre `inviteContext`
//
// El helper solo necesita `{ postCredentialUrl: string }`. Acepta el shape
// completo del `inviteContext` (con `placeSlug` + `placeName` adicionales)
// por structural typing — no requiere que los callers strippen campos.

export function resolvePostCredentialDestination(opts: {
  inviteContext?: { postCredentialUrl: string } | null;
  returnTo?: string | null;
  hubFallback: string;
}): string {
  return (
    opts.inviteContext?.postCredentialUrl ??
    opts.returnTo ??
    opts.hubFallback
  );
}
