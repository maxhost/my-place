# Plan de sesiones — Feature B: Custom Domain Host Routing V1

> _Write-back ejecutado 2026-05-22. Plan original archivado en `~/.claude/plans/wise-greeting-mccarthy.md` (referencia histórica). Esta página documenta lo que efectivamente se cerró por sesión — commits, tags, desviaciones del plan original, y por qué._

> **DS S2 update (2026-05-23)**: Este plan de sesiones es histórico (Feature B V1 cerrada). Las menciones forward-looking a "Feature C OIDC SSO" / "`prompt=none`" reflejaban el plan original (ADR-0001), pero **Feature C V1 se entregó con Signed Ticket pattern (ADR-0032)**, no con OIDC canonical. Endpoints reales: `/api/auth/sso-{init,issue,redeem,jwks}` (no callback handler OIDC). Slice canónico de Feature C: [`docs/features/custom-domain-sso/`](../custom-domain-sso/spec.md). El componente `<AuthGateForCustomDomain>` (Feature B V1) sigue existiendo pero ahora se reach via CTA fallback de `<SsoFallbackPanel>` (S6 Feature C), no como branch primario.

## Resumen ejecutivo

- **Baseline previo**: `baseline/pre-feature-b` @ `1dea7b5` (Feature A V1 deployed READY).
- **Baseline final local**: `baseline/feature-b-s6-done` (este commit). Push autorizado + smoke production + tag `baseline/feature-b-done` pendientes (gestionados por el user).
- **Sesiones planeadas**: 6 (S0, S1, S2, S3, S5, S4, S6 — orden refinado por dependencia typecheck del gate page consumiendo keys de S5).
- **Sesiones ejecutadas**: 11 (S0–S3, S5, **S4 split en S4a/b/c/d/e**, S6).
- **Razón del split de S4**: la sesión S4 original mezclaba 4 capas (helper `auth-redirect`, gate page, 2 bugs pre-existentes en redirects, 404 host-aware) y >5 archivos cruzando DB + routing infra + UI. La regla "un prompt = una responsabilidad / >5 archivos = dividir" del CLAUDE.md aplicó. Las 5 sub-sesiones son disjuntas en archivos y cada una commiteó + tageó.
- **Smoke programático local**: 9/9 ✅ ([detalle en `spec.md`](./spec.md#smoke-ejecutado-2026-05-22)).
- **Suite automatizada al cierre**: 550/550 tests · 0 typecheck errors · 0 lint warnings · 0/0 × 5 i18n parity · build OK.

## Cadence aplicada

```
[pre-session: /compact + commit + verify tag]
→ ejecutar sesión (TDD obligatorio en código; locked-files declarados a parallel agents cuando los hubo)
→ [post-session: typecheck + lint + test + build + tag baseline/feature-b-s<N>-done]
→ COMPACT (pedido explícito del user antes de la siguiente sesión)
→ siguiente sesión
```

Push autorizado quedó reservado a S6, sólo con autorización explícita del user por turno (no se ejecutó en este turno: ver §S6).

## Sesiones

### S0 — Docs: ADR-0031 + spec + tests + multi-tenancy (sin código)

- **Commit**: `093ae55` · **Tag**: `baseline/feature-b-s0-done`.
- **Files** (5): `+ docs/decisions/0031-custom-domain-routing-v1.md` · `+ docs/features/custom-domain-routing/spec.md` · `+ docs/features/custom-domain-routing/tests.md` · `M docs/multi-tenancy.md` · `M docs/decisions/README.md`.
- **Parallel agents**: yo escribí ADR-0031 (canónico); 3 agents disjoint en paralelo para spec, tests y multi-tenancy + README.
- **Resultado**: ADR-0031 documenta las 7 decisiones (lookup DEFINER + runtime Node + cookie cross-domain gap + cost budget V2 + defensive validation + bug fixes pre-existentes + cron post-B).
- **Desviación**: ninguna respecto al plan.

### S1 — Migration `0009_lookup_place_by_domain` + RLS tests

- **Commit**: `66652b0` · **Tag**: `baseline/feature-b-s1-done`.
- **Files** (3): `+ src/db/migrations/0009_lookup_place_by_domain.sql` · `M src/db/migrations/meta/_journal.json` · `+ src/db/__tests__/lookup-place-by-domain.test.ts`.
- **Resultado**: función `app.lookup_place_by_domain(p_host text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER` con payload `{place_id, slug, default_locale}`, `REVOKE FROM PUBLIC` + `GRANT EXECUTE TO "app_system"`. 8 tests RLS (verified, NULL, archived ambas tablas, case-insensitive, host inexistente, caller anónimo, regression directo sobre `place_domain`).
- **Desviación**: ninguna.

### S2 — Wrapper lookup + extensión HostZone async + runtime gating

- **Commit**: `da6c15d` · **Tag**: `baseline/feature-b-s2-done`.
- **Files** (4): `+ src/shared/lib/custom-domain-lookup.ts` · `+ src/shared/lib/__tests__/custom-domain-lookup.test.ts` · `M src/shared/lib/host-routing.ts` · `M src/shared/lib/__tests__/host-routing.test.ts`.
- **Gating step**: confirmado **Node runtime** (no `export const runtime` en `proxy.ts`, no `experimental.runtime` en `next.config.ts`). Driver Neon = `@neondatabase/serverless` ws (canon ADR-0018).
- **Parallel agents**: yo extendí `host-routing.ts` (single owner del discriminated union); A wrote wrapper + tests; B extended host-routing tests.
- **Resultado**: `lookupPlaceByDomain(host): Promise<{placeId,slug,defaultLocale}|null>` con fail-safe (error DB → null + log) y dedup `React.cache()`. `resolveHostWithCustomDomains(host, root?, lookup?)` async con heurística de skip (apex/www/localhost/vercel.app → 0 queries DB). `resolveHost` sync queda intacto.
- **Desviación**: ninguna.

### S3 — Proxy async + slug→host defensive validation

- **Commit**: `b996b9f` · **Tag**: `baseline/feature-b-s3-done`.
- **Files** (3): `M src/proxy.ts` · `+ src/__tests__/proxy.test.ts` · `M src/app/(app)/place/[placeSlug]/layout.tsx`.
- **Resultado**: proxy pasa a `async function` con branch `custom-domain` que rewrite a `/place/${slug}${rest}`. Defensive validation en layout re-llama `lookupPlaceByDomain(host)` (deduplicado por React.cache → 1 query física por request) y dispara `notFound()` si el host no matchea el slug actual. 8 escenarios integration test del proxy.
- **Desviación**: ninguna.

### S5 — i18n keys `customDomainRouting.authGate.*` × 6 locales (ANTES de S4)

- **Commit**: `6c7555f` · **Tag**: `baseline/feature-b-s5-done`.
- **Files** (6): `M src/i18n/messages/{es,en,fr,pt,de,ca}.json`.
- **Parallel agents**: yo escribí `es.json` canónico; 5 agents disjoint en paralelo para en/fr/pt/de/ca.
- **Resultado**: namespace `customDomainRouting.authGate` con `{title, body, cta, help}` × 6 locales. Paridad 0/0 enforced por `scripts/check-translations.mjs`.
- **Desviación**: ninguna. Orden S5 antes de S4 justificado para que S4 typecheck contra keys ya existentes.

### S4 — Auth gate + bugs pre-existentes (split en 5 sub-sesiones)

Sesión S4 del plan original tenía scope amplio (helper + gate UI + 3 page modifications + 2 bug fixes). Se dividió en 5 sub-sesiones por la regla "un prompt = una responsabilidad / >5 archivos = dividir".

#### S4a — `localeCookie` cross-subdomain via `NEXT_PUBLIC_APP_URL`

- **Commit**: `4812b5b` · **Tag**: `baseline/feature-b-s4a-done`.
- **Scope**: Fundación previa al bug-fix S4c — la cookie `NEXT_LOCALE` viajaba como host-only (no compartida cross-subdomain). S4a deriva `Domain=.<rootHost>` del env `NEXT_PUBLIC_APP_URL` vía helper privado `localeCookieDomain()` en `src/i18n/routing.ts`. Custom domains NO comparten cookie (origin distinto del root, por design — el locale del custom domain viene de `place.default_locale` resuelto en el layout).
- **Decisión**: split agregado fuera del plan original. Razón documentada en commit.

#### S4b — Migration `0010_lookup_place_locale_by_slug` + wrapper TS

- **Commit**: `94db62d` · **Tag**: `baseline/feature-b-s4b-done`.
- **Scope**: el layout (zona-place, subdomain canon) necesita resolver `place.default_locale` para servir `<html lang>` correcto cuando NO hay sesión local (visitante anónimo en subdomain canon). RLS owner-only filtraría a 0 rows. S4b agrega una segunda función `SECURITY DEFINER` análoga al lookup-by-domain pero por slug, con payload escalar `text` (sólo `default_locale`). Wrapper TS espeja el shape de S2.
- **Decisión**: split agregado fuera del plan original. Razón: el plan original asumía que el layout siempre tenía sesión; el smoke pre-S4 mostró que visitantes anónimos en `mi-place.place.community` veían `<html lang>` colgado del fallback canónico, no de `place.default_locale`. Fix llegó a S4b para no mezclar con bug fixes S4c.

#### S4c — Bug 1 wire (layout) + fix pre-existente login locale dinámico

- **Commit**: `dc9a726` · **Tag**: `baseline/feature-b-s4c-done`.
- **Scope**: `+ src/shared/lib/auth-redirect.ts` (helper puro con `buildOriginalDomainLogin({slug, defaultLocale})` que arregla el bug pre-existente: redirect hardcoded a `https://place.community/es/login` → `https://{slug}.place.community/{defaultLocale}/login`). Wire en `settings/page.tsx` + `settings/domain/page.tsx`. Layout orquesta 3 fuentes de locale (place owner-session resolvido, lookup-by-slug anónimo del S4b, fallback canónico) con `React.cache()` dedup intra-request. Tests del helper + tests de layout.
- **Files** (>5 por design, justificado en cohesion del bug fix + 3-source orchestration).

#### S4d — Auth gate UX para custom-domain (slice nuevo)

- **Commit**: `f85e571` · **Tag**: `baseline/feature-b-s4d-done`.
- **Scope**: nuevo slice `src/features/custom-domain-routing/` con `public.ts` + `ui/auth-gate.tsx` (Server Component). Copy resuelto vía `getTranslations({locale: place.defaultLocale, namespace: 'customDomainRouting.authGate'})`. Wire en `settings/page.tsx` + `settings/domain/page.tsx`: si host es custom-domain Y no hay sesión → render `<AuthGateForCustomDomain>`; else flujo previo (helper de S4c).

#### S4e — Bug 2 host-aware 404 + i18n `placeNotFound` × 6 locales

- **Commit**: `6ab143b` · **Tag**: `baseline/feature-b-s4e-done`.
- **Scope**: `+ src/app/(app)/place/[placeSlug]/_lib/place-not-found-context.ts` (helper puro 3-branch: custom-domain | place canon | marketing/inbox defensive). Rewrite de `not-found.tsx` (25 LOC → ~80 LOC orquestador) — `not-found.tsx` no recibe `params`, así que deriva slug+locale del `HostZone` resuelto vía el lookup S2 + S4b deduplicado en la misma request. Custom-domain 404 usa link relativo `/` (defense-in-depth anti-doxxing: no revelar slug interno al visitor que sólo conoce `nocodecompany.co`). Namespace top-level nuevo `placeNotFound.*` × 6 locales (reusa title/body/ctaHome del namespace marketing `notFound` para consistencia de tono; `ctaApex` es key nueva para la defensive branch).

### S6 — Smoke E2E + docs close + push autorizado (este commit)

- **Tags creados**: `baseline/feature-b-s6-done` (commit `a1d354f` — docs locales pre-push) + `baseline/feature-b-done` (commit posterior — production smoke + close-out final).
- **Files** (3 + 3): `M docs/features/custom-domain-routing/spec.md` (×2) · `M docs/decisions/0031-custom-domain-routing-v1.md` (×2) · `+ docs/features/custom-domain-routing/plan-sesiones.md` (mod ×1 post-prod-smoke).
- **Locked files** (verified empty diff): TODO el código de S1–S5 (proxy.ts, host-routing.ts, custom-domain-lookup.ts, place-locale-lookup.ts, auth-redirect.ts, migraciones 0009/0010, layout.tsx, settings/page.tsx, settings/domain/page.tsx, not-found.tsx, place-not-found-context.ts, slice custom-domain-routing, i18n × 6 locales).
- **Smoke local**: programático 9/9 ✅ (substituye smoke manual `/etc/hosts` + browser por `curl -H "Host: ..."`); fixture temporal purgada post-smoke. Detalle en spec.md.
- **Push autorizado 2026-05-22**: `git push maxhost main` (11 commits, `1dea7b5..a1d354f main -> main`). Vercel auto-deploy `dpl_7HYcUAdA3mrdsxhCackGcE4AAeJ4` READY en ~43s (build) sobre target=production, region iad1. Migrations 0009 + 0010 aplicadas por `maybe-migrate.mjs` durante el build (`pg_proc` confirma). `nocodecompany.co.verified_at` intacto (sin regresión Feature A).
- **Smoke production**: 4/4 server-side ✅ (1 root, 2 deploy READY, 3 Neon estado, 4 AuthGate localizado). Escenarios 5–6 quedan user-driven (browser + auth cookie). Detalle en spec.md §Smoke ejecutado 2026-05-22.

## Estado final post-S6

`baseline/feature-b-done` ✅ — Feature B Custom Domain Host Routing V1 cerrada end-to-end (planning + 11 sesiones + push + deploy READY + smoke production server-side). Producción sirve el contenido del place transparentemente en `https://nocodecompany.co/...` con URL pública intacta, SSL Let's Encrypt válido y AuthGate localizado para owners en owner-only pages. Slice `custom-domain-routing` recibió `<SsoFallbackPanel>` en S6 de Feature C V1 (ADR-0032, Signed Ticket) — extensión ya realizada, no future.

## Rollback disponible

Cada tag `baseline/feature-b-s<N>-done` es un punto de restauración granular:

```bash
# Ej: revertir todo Feature B a Feature A V1 deployed
git reset --hard baseline/pre-feature-b

# Ej: revertir sólo S4e (404 host-aware)
git reset --hard baseline/feature-b-s4d-done
```

Las migrations 0009 + 0010 quedan aplicadas en el branch Neon `dev`; en `production` aplican vía `maybe-migrate.mjs` al primer deploy post-push. Rollback de migraciones requeriría `DROP FUNCTION` manual (no se incluye reverse SQL automatizado V1).

## Riesgos pendientes documentados

- **Cron safety net (#103)**: opcional V1.1. Post-B su importancia aumenta — si owner cambia provider DNS sin re-configurar, visitante verá SSL error de Vercel mientras `verified_at IS NOT NULL` queda stale. Lazy poll dual V9+V6 (ADR-0029) cubre el escenario sólo cuando el owner vuelve a `/settings/domain`. Detalle en ADR-0031 §"Operational risks" + spec.md §"Operational risks".
- **Auth gap cookie cross-domain**: Feature C V1 (ADR-0032, **Signed Ticket pattern**) cierra estructuralmente con cookie host-only `__Host-place_sso_session` + silent redirect chain `init→issue→redeem` (no `prompt=none`, que es OIDC-specific). Gate page V1 (Feature B) queda como CTA fallback dentro de `<SsoFallbackPanel>`.
- **V2 cache layer del lookup**: criterio cuantitativo en ADR-0031 §6 — p95 proxy > 100ms 1h sostenido OR rate > 100/min 10min OR reporte cualitativo "rutea lento la primera vez del día". Cualquiera de los 3 → V2 con TTL 60s en module scope del wrapper.

## Próximos pasos

1. **Push autorizado por el user** (turn-by-turn explícito) → Vercel auto-deploy → `maybe-migrate.mjs` aplica 0009 + 0010 en production branch.
2. **Smoke production** (6 escenarios, sección §"Smoke ejecutado" del spec.md). Tag final `baseline/feature-b-done` al cierre.
3. **Feature C** (Signed Ticket SSO desde custom domain, ADR-0032) — **V1 deployed 2026-05-23**. Slice: [`docs/features/custom-domain-sso/`](../custom-domain-sso/spec.md).
4. **#103 Cron safety net** — agendar follow-up técnico de calidad operativa post-B; sin blocker, pero con importancia técnica creciente.
