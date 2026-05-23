# Custom Domain Host Routing V1 — Feature B

> _Spec creado 2026-05-22 · Last-updated 2026-05-22. Status: **S0–S6 cerradas 2026-05-22 (sin push aún)**. Cierra el slice `custom-domain-routing`: el proxy resuelve custom domains contra DB y rewrites internamente a `/place/{slug}/...`, sirviendo el contenido del place sin cambiar la URL del browser. Decisiones canónicas en [ADR-0031](../../decisions/0031-custom-domain-routing-v1.md), apoyada por ADR-0026 (Feature A V1) + ADR-0028 (promoción del slice anfitrión) + ADR-0029 (fix verified-false-positive) + ADR-0030 (split por capa de operación). Plan ejecutado (sesiones + write-back) en [`./plan-sesiones.md`](./plan-sesiones.md). Baseline tag post-S6: `baseline/feature-b-s6-done` (production smoke + tag final `baseline/feature-b-done` post-push autorizado)._

## Contexto

Feature A (slice `custom-domain` + `custom-domain-verification`) cerró el registro + verificación lazy del dominio propio: el owner que entra a `/settings/domain`, escribe `nocodecompany.co`, configura DNS en su provider y vuelve, ve **"Verificado, SSL activo"** (deployed `1dea7b5`, 2026-05-22). El estado `verified` queda persistido en `place_domain.verified_at IS NOT NULL`, y el copy del `<DomainSection>` ya admite la promesa: "Próximamente vas a poder usarlo como acceso directo a tu place".

Feature B cierra esa promesa. Hoy, al visitar `https://nocodecompany.co/`, el visitante cae a la **landing de marketing** — `src/shared/lib/host-routing.ts:resolveHost` retorna `marketing` para cualquier host que no sea apex / `app.*` / `*.place.community` / `*.localhost` / `*.vercel.app`. Es el fail-safe documentado en ADR-0005 §10 ("nunca servir el place de otro en un host ajeno"); el lookup contra DB nunca se intentó porque Feature A nunca lo necesitó.

Feature B implementa el lookup. El proxy se vuelve `async`, consulta `app.lookup_place_by_domain(host)` (función Postgres `SECURITY DEFINER`, ver ADR-0031 §1), y si el host matchea un `place_domain` activo y verificado, **rewrite interno** a `/place/{slug}{path}` — el visitante ve la URL `https://nocodecompany.co/` intacta en el browser y el contenido del place servido por `(app)/place/[placeSlug]/page.tsx`.

**Auth gap V1**. La cookie de sesión Neon Auth está scopeada a `Domain=.place.community` (decisión del SDK, ADR-0001 §"Sesión y SSO"). Un custom domain como `nocodecompany.co` es host-only — el browser NO envía la cookie del apex. En consecuencia, owners autenticados en `place.community` NO tienen sesión local en su custom domain. Feature B documenta y cubre este gap V1 con un **gate page educativo server-side** (ver §Gate page abajo); el cierre estructural (OIDC SSO + JWT host-only del custom domain + silent SSO via `prompt=none`) queda para Feature C, plan posterior.

**Relación con Feature C**. Feature B deja el proxy `async` (un wrapper sobre el `resolveHost` sync existente), el shape jsonb del lookup incluye `place_id` (Feature C lo necesita para resolver el `oauth_client_id`), y el slice nuevo `custom-domain-routing` queda como el lugar donde Feature C agregará el callback handler OIDC. El gap auth de V1 se cierra sin refactor estructural — el copy/CTA del gate evoluciona, pero el slice no.

## Scope V1

Detalles canónicos en [ADR-0031](../../decisions/0031-custom-domain-routing-v1.md). Resumen:

**IN**:

- Routing real `{custom-domain} → /place/{slug}/*` vía **rewrite interno** (URL del browser intacta).
- Función Postgres `app.lookup_place_by_domain(host)` `SECURITY DEFINER STABLE`, payload jsonb `{place_id, slug, default_locale}`, `EXECUTE` para `app_system`, `REVOKE` de PUBLIC.
- Wrapper anonymous-safe `src/shared/lib/custom-domain-lookup.ts` envuelto en `React.cache()` para dedup intra-request.
- Variante async de host-routing: `resolveHostWithCustomDomains(rawHost, rootHost?, lookup?): Promise<HostZone>` + extensión del discriminated union `HostZone` con `{ zone: "custom-domain"; placeId; slug; defaultLocale }`. La función pura `resolveHost(host, root?)` SYNC queda **intacta** (backward compat + reuso interno).
- `src/proxy.ts` pasa a `async function proxy(req)`, branch nuevo `if (target.zone === "custom-domain")` con rewrite a `/place/${target.slug}${pathname}`.
- `<AuthGateForCustomDomain>` Server Component del slice nuevo `custom-domain-routing`, copy localizado en `place.default_locale`, link explícito al subdomain canónico.
- Defensive validation slug↔host en `src/app/(app)/place/[placeSlug]/layout.tsx`: re-lookup del host vía `lookupPlaceByDomain` (deduplicado por `React.cache()` → 0 queries físicas extra) y `notFound()` si mismatch.
- Fix de **3 bugs pre-existentes** en redirects hardcoded: locale `es` literal en `settings/page.tsx:76` + `settings/domain/page.tsx:81` y apex `place.community` literal en `not-found.tsx:17`. Se centralizan en helper `src/shared/lib/auth-redirect.ts` con `buildOriginalDomainLogin({slug, defaultLocale})`.
- i18n keys `customDomainRouting.authGate.{title, body, cta, help}` × 6 locales con paridad 0/0 enforced por `scripts/check-translations.mjs` (S5).
- Proxy ramifica con order: marketing → inbox → place → custom-domain. El wrapper async garantiza que custom-domain SIEMPRE se evalúe antes de devolver marketing definitivo cuando el host es candidato (heurística pura, sin DDoS DB en hosts triviales).

**OUT** (cada uno con razón):

- **OIDC SSO desde custom domain**: Feature C, plan posterior. Requiere Better Auth OIDC Provider plugin cableado + callback handler `/api/auth/callback/place-idp/route.ts` montado sobre el custom domain + cookie host-only con JWT propio + silent SSO via `prompt=none` para owners ya autenticados en apex.
- **Cookie host-only del custom domain con JWT propio**: Feature C. V1 no toca cookies del custom domain.
- **Provisioning de `oauth_client_id`**: Feature C. La columna queda NULL en V1 (ADR-0027 futura documentará el script idempotente de provisioning retroactivo).
- **In-memory cache del lookup**: V2 (ADR-0031 §6). Criterio cuantitativo de activación: p95 latencia del proxy > 100ms sostenido 1h, OR request rate > 100/min sostenido 10min, OR reporte cualitativo de "el dominio rutea lento la primera vez del día". Cualquiera de los 3 → V2 con TTL 60s en module scope del wrapper.
- **Auto-redirect ciego sin gate**: descartado por UX (ADR-0031 §A2). Loop perceptual cuando el browser bloquea cookies cross-site (Safari ITP, Firefox ETP); el owner queda rebotado sin entender por qué. Link explícito = owner entiende + tiene el control.
- **Servir contenido público de `/settings` con la página oculta** (404 disfrazado): descartado (ADR-0031 §A3). Romper "URL del browser = lo que el usuario pidió" mina trust.
- **Multi-domain por place**: V2. El schema ya lo soporta (FK `place_id` no único en `place_domain`); B asume 1 fila activa por place (alineado con el constraint del registro de Feature A). Cuando V2 lo habilite, el lookup retorna `LIMIT 1` ordenando por `is_default DESC NULLS LAST` — cambio aditivo en la función SQL.
- **Cron safety net `*/15`** (#103): opcional V1.1, importancia aumenta post-B (ver §Operational risks). Sin él, si el DNS del owner se rompe meses después, el visitante ve SSL error de Vercel mientras `verified_at IS NOT NULL` queda stale.
- **Edge runtime para el proxy**: V1 confirma **Node runtime** (Next 16 default + Fluid Compute). Driver Neon = `neon-serverless` (ws). Si el runtime cambia a Edge en futuro, swap del wrapper al driver HTTP (`neon()`) es ~15 LOC (ADR-0031 §3).
- **Persistir el resultado del lookup en cookie del response**: descartado (ADR-0031 §A6). Cookie cross-domain no se setea con `rewrite`; misma complejidad de invalidación que cache pero con menos control.
- **Routing por `X-Forwarded-Host` en vez de `Host`**: descartado (ADR-0031 §A7). Vercel pasa el host original vía `Host`; `X-Forwarded-Host` no es estable cross-platforms.

## Flow del request

Diagrama del request lifecycle post-B (las flechas describen control flow, no datos):

```
visitor browser → DNS (CNAME / A) → Vercel edge → src/proxy.ts (async)
                                                       ↓
                                          resolveHostWithCustomDomains(host, root, lookup)
                                                       ↓
                                          ┌────────────┼────────────┬─────────────────┐
                                          ↓            ↓            ↓                 ↓
                                       marketing     inbox        place           custom-domain
                                          ↓            ↓            ↓                 ↓
                                       intl mw     compose       rewrite           lookupPlaceByDomain(host)
                                                   intl+rw       /place/{slug}     (anonymous-safe vía DEFINER)
                                                                                       ↓
                                                                                  {placeId, slug, defaultLocale} | null
                                                                                       ↓
                                                                              ┌────────┴────────┐
                                                                              ↓ null            ↓ hit
                                                                          marketing       rewrite /place/{slug}{path}
                                                                          (fail-safe)         (URL del browser intacta)
                                                                                                  ↓
                                                                              (app)/place/[placeSlug]/layout.tsx
                                                                                                  ↓
                                                                              defensive validation (host↔slug, React.cache hit)
                                                                                                  ↓
                                                                              page (placeholder) o gate page según sesión + path
```

**Comentario step-by-step**:

1. **DNS resolution**: el `CNAME` o `A` record que el owner configuró en su provider apunta a Vercel. Vercel emite el SSL automáticamente cuando el dominio está verified (ADR-0026 §"Verificación lazy"). El handshake TLS llega antes del routing aplicativo — si el DNS owner se rompe, el visitante ve SSL error de Vercel ANTES de tocar el proxy (ver §Operational risks #1).

2. **Vercel edge → proxy**: el `Host` header llega tal cual lo envió el browser. Vercel NO normaliza el casing. El proxy (`src/proxy.ts`) corre en Node runtime (Fluid Compute, default Next 16), `preferredRegion = "iad1"` para co-localizar con Neon.

3. **`resolveHostWithCustomDomains` (S2 del plan)**: wrapper async sobre `resolveHost` sync. Llama primero `resolveHost(host, rootHost)` sync para clasificar marketing/inbox/place/desconocido. Si el resultado es `marketing` Y el host **no** es candidato trivial (apex, `www.<root>`, `*.vercel.app`, `localhost`, `*.localhost`) → llama `lookup(host)`. La heurística "no candidato trivial" es **pura** (sin red ni DB) — evita DDoS de Neon en hosts random.

4. **`lookupPlaceByDomain(host)` (S2)**: ejecuta `SELECT app.lookup_place_by_domain(${host})` contra Neon como cliente anónimo (sin claim de sesión). La función Postgres es `SECURITY DEFINER`, dueño `neondb_owner`, `EXECUTE` solo `app_system`. Retorna jsonb `{place_id, slug, default_locale}` si el host matchea un `place_domain` activo y verificado, o NULL escalar. El wrapper retorna `null` en lookup-null y también en throws (fail-safe; el visitante ve marketing en vez de un 500).

5. **Branch en proxy**: si el wrapper retornó `{zone: "custom-domain", placeId, slug, defaultLocale}`, el proxy hace:

   ```ts
   const url = req.nextUrl.clone();
   url.pathname = `/place/${target.slug}${req.nextUrl.pathname}`;
   return NextResponse.rewrite(url);
   ```

   Preserva query string (`req.nextUrl.searchParams` quedan en el clone). Preserva cookies/headers del request (rewrite NO crea response nueva — Next propaga el request intacto al rewritten path). NO invoca `intlMiddleware` (el i18n del custom domain es DB-based vía `place.default_locale`, no negociado por path).

6. **Rewrite a `/place/{slug}{path}`**: Next ejecuta el route group `(app)/place/[placeSlug]/...` con `placeSlug` resuelto al slug del lookup. El `layout.tsx` es el primer Server Component que ve `placeSlug` resuelto + tiene acceso a `headers()`.

7. **Defensive validation en layout (S3)**: el layout obtiene `headers().get('host')`. Si el host es apex / `*.place.community` / `localhost` / `*.localhost` / `*.vercel.app` → trusted, no chequea (los rewrites desde subdomain canónico ya están validados por proxy + middleware). Else → llama `lookupPlaceByDomain(host)` (dedup intra-request por `React.cache()` → la query ya ocurrió en proxy → 0 queries físicas extra). Si retorna `null` → `notFound()`; si retorna `{slug: lookupSlug}` y `lookupSlug !== placeSlug` → `notFound()`. Defensa-en-profundidad contra bugs del proxy o manipulación interna.

8. **Page o gate page**: el page Server Component (`/settings/page.tsx`, `/settings/domain/page.tsx`, `/page.tsx`) detecta custom domain con `isCustomDomainHost(host, slug, rootHost)` (heurística pura) y si la page es owner-only + no hay sesión local → render `<AuthGateForCustomDomain>`. Si la page es anonymous-allowed (root del place) → sirve normalmente.

## Gate page

`<AuthGateForCustomDomain>` es un Server Component del slice nuevo `custom-domain-routing`. **1 estado visible** — no maneja transiciones, ni client-side state, ni auto-redirect. El owner click → llega al subdomain canónico → sesión apex levanta → vuelve al custom domain como visitante anónimo o navega libre.

**Elementos visibles**:

- **Title**: copy localizado por la key `customDomainRouting.authGate.title`. Sugerencia base (cerrada en S5 con los 6 locales): "Iniciá sesión en Place".
- **Body**: copy con placeholder `{slug}`. Key `customDomainRouting.authGate.body`. Sugerencia base: "Para administrar **{slug}** tenés que iniciar sesión en su dirección original en Place. Esta URL es la cara pública del lugar para tus visitantes."
- **CTA**: link visible (no `<button>`, no auto-redirect). Key `customDomainRouting.authGate.cta`. Sugerencia base: "Ir a la dirección original". El `href` lo arma el helper `buildOriginalDomainLogin({slug, defaultLocale})` → `https://{slug}.place.community/{defaultLocale}/login`.
- **Help**: copy explicativo bajo el CTA. Key `customDomainRouting.authGate.help`. Sugerencia base: "Mientras tanto, tus visitantes pueden seguir usando este dominio normalmente."

**Locale resolution**: el locale del gate page es SIEMPRE `place.default_locale` (resuelto desde `lookupPlaceByDomain(host)`). NO `Accept-Language`, NO cookie `NEXT_LOCALE`, NO path. Espeja ADR-0022 (i18n DB-based del settings) — el chrome del place visto desde su dominio tiene el locale que el owner editó conscientemente en `/settings`.

**Por qué link y no `<button>` con `redirect()` server-side**: el link explícito da control al owner — ve la URL destino antes de hacer click, puede cmd+click para abrir en nueva pestaña, puede inspeccionar el `href`. Un `redirect()` server-side (o `<button>` con Server Action) generaría un flow más opaco. El link además es **idempotente al click** — un refresh accidental no relanza ninguna acción.

**Por qué no botón "Iniciar sesión local"**: no existe path local V1. El gap se cubre estructuralmente en Feature C (OIDC SSO). El gate V1 es honestidad UX: "para administrar, andá a la URL canónica". El día que Feature C esté, el copy/CTA evoluciona (probablemente "Iniciar sesión" → silent SSO con `prompt=none`); el slice queda como está.

**Pages anonymous-allowed**: el root del place (`(app)/place/[placeSlug]/page.tsx`) NO usa gate. El placeholder "Este lugar está casi listo" se sirve idéntico en subdomain canónico y custom domain — UX correcta para visitantes anónimos pre-Feature C.

**Pages owner-only que SÍ usan gate (S4)**:

- `(app)/place/[placeSlug]/settings/page.tsx`
- `(app)/place/[placeSlug]/settings/domain/page.tsx`

Ambas pages detectan `isCustomDomainHost(host)` + `!session` y, en ese caso, renderizan `<AuthGateForCustomDomain slug={placeSlug} defaultLocale={place.defaultLocale} returnPath={...} />` en lugar del shell + section. Si hay sesión local (imposible en V1 sin Feature C, pero defensivo) → flow normal.

## Edge cases

Cada caso con: escenario, comportamiento esperado, dónde se enforce.

1. **Host case-insensitive**. Escenario: el browser envía `Host: NoCodeCompany.co` (RFC 7230 lo permite). Comportamiento: matchea `nocodecompany.co` registrado en DB. Enforce: `resolveHost` ya hace `host.toLowerCase()` (línea `host = rawHost.split(":")[0]?.trim().toLowerCase()`); el lookup SQL hace `lower(pd.domain) = lower(p_host)` (defensa-en-profundidad por si el INSERT del registro dejó casing mixto).

2. **Host con `:port` (smoke local)**. Escenario: `nocodecompany.localhost:3000`. Comportamiento: `resolveHost` strip-ea el puerto (`host.split(":")[0]`); el lookup compara contra `nocodecompany.localhost`. Si el dev registró `nocodecompany.localhost` en `place_domain` con verified_at (smoke E2E manual), matchea. En producción este caso no ocurre (Vercel siempre 443).

3. **Host `*.vercel.app` (preview URLs)**. Escenario: `pr-123-place-mxh.vercel.app`. Comportamiento: marketing fallback sin query DB. Enforce: la heurística del wrapper async detecta el suffix `.vercel.app` y NO invoca `lookupPlaceByDomain`. Los preview deploys nunca son custom domains válidos por construcción (ADR-0031 §2 lista los hosts triviales).

4. **Host apex (`place.community`)**. Escenario: visitante en la landing. Comportamiento: marketing sin query DB. Enforce: `resolveHost` retorna `marketing` (línea `if (host === base || host === \`www.${base}\`) return { zone: "marketing" }`); el wrapper async detecta apex como "no candidato" y skip-ea el lookup.

5. **Host `www.place.community`**. Escenario: visitante navega con `www`. Comportamiento: marketing sin query DB. Enforce: idem #4.

6. **Host con custom domain unknown**. Escenario: bot/crawler hits `random-domain-xyz.com` que apunta a Vercel pero NO está en `place_domain`. Comportamiento: marketing fallback (no DDoS DB porque el wrapper async sí dispara la query, pero el lookup retorna NULL y el wrapper retorna `{zone: "marketing"}`). Cost budget: 1 query Neon iad1 (~5-20ms) por hit. Si el volumen de hits unknown crece (bots), activar V2 cache (criterio cuantitativo en ADR-0031 §6).

7. **Lookup retorna `null` desde el layout (defensive validation)**. Escenario: por bug del proxy o manipulación interna de un rewrite, un request con host `custom-unknown.com` llega a `(app)/place/algun-slug/layout.tsx` sin pasar por el branch custom-domain del proxy. Comportamiento: el layout llama `lookupPlaceByDomain(host)` → retorna `null` → `notFound()`. No se sirve nada. Enforce: layout `(app)/place/[placeSlug]/layout.tsx` (S3).

8. **Layout detecta mismatch slug↔host**. Escenario: request con host `nocodecompany.co` rewrite-ado a `/place/otro-slug/...` (manipulación interna o bug). Comportamiento: el layout llama `lookupPlaceByDomain(host)` → retorna `{slug: "mi-place"}`, NO matchea `placeSlug = "otro-slug"` → `notFound()`. Enforce: comparación en el layout, post-React.cache.

9. **Owner sin sesión local en custom domain `/settings`**. Escenario: owner típico V1. Comportamiento: gate page localizado en `place.default_locale` con link al subdomain canónico. Enforce: `settings/page.tsx` detecta `isCustomDomainHost(host)` + `!session` → render `<AuthGateForCustomDomain>` (S4).

10. **Visitante anónimo en custom domain `/` (root del place)**. Escenario: visitante público del place. Comportamiento: placeholder del place servido normalmente (NO gate). Enforce: `(app)/place/[placeSlug]/page.tsx` es anonymous-allowed; no aplica gate.

11. **Custom domain con `verified_at NULL` (pending)**. Escenario: owner registró el dominio pero el DNS aún no propagó. Comportamiento: el lookup NO retorna el row porque la función filtra `WHERE pd.verified_at IS NOT NULL`. El wrapper async retorna `{zone: "marketing"}`. El visitante ve la landing — no service hasta verified. Enforce: predicado SQL en `app.lookup_place_by_domain` (ADR-0031 §1).

12. **Custom domain `archived_at NOT NULL`**. Escenario: el owner archivó el dominio en `/settings/domain`. Comportamiento: el lookup NO retorna el row (filtra `WHERE pd.archived_at IS NULL`). Marketing fallback. Enforce: predicado SQL. El partial unique index libera el dominio para re-registro (ADR-0026 §2); el row archived queda en DB para auditoría pero NO afecta routing.

13. **Custom domain matchea pero `place.archived_at NOT NULL` (tombstone)**. Escenario: el place fue archived en una operación administrativa (no UI V1). Comportamiento: el lookup NO retorna el row (filtra `WHERE p.archived_at IS NULL`). Marketing fallback. Enforce: predicado SQL.

14. **Query string preservado en rewrite**. Escenario: `https://nocodecompany.co/?utm_campaign=launch&ref=twitter`. Comportamiento: el rewrite preserva los params. Enforce: `req.nextUrl.clone()` incluye `searchParams`; el assign de `url.pathname` no toca `url.search`. Next propaga el clone completo.

15. **Trailing slash preservado**. Escenario: `https://nocodecompany.co/eventos/`. Comportamiento: el rewrite genera `/place/mi-place/eventos/` (slash final intacto). Enforce: `url.pathname === "/"` se trata como `""` para evitar `//`; cualquier otro path se concatena tal cual (incluyendo trailing slash si lo trae).

16. **Custom domain con path `/api/...`**. Escenario: `https://nocodecompany.co/api/...`. Comportamiento: el proxy NO se invoca para `/api/*` (matcher excluye `api`); el request va directo al route handler. Si en futuro Feature C agrega `/api/auth/callback/place-idp` montado sobre custom domain, ese handler maneja su propio routing — el branch `custom-domain` del proxy no aplica.

17. **Custom domain con asset estático**. Escenario: `https://nocodecompany.co/_next/static/...`. Comportamiento: el proxy NO se invoca (matcher excluye `_next`); el asset se sirve directamente.

## Pre-existing bugs fixed by B

Auditoría de `src/app/(app)/place/[placeSlug]/` reveló 3 redirects con valores hardcoded que NO son bugs funcionales en V1 (pre-B) pero introducen UX confusa post-B (owner en custom domain en alemán rebotado al apex en español):

1. **`src/app/(app)/place/[placeSlug]/settings/page.tsx:76`** — `redirect("https://place.community/es/login")`. Locale `es` literal.
2. **`src/app/(app)/place/[placeSlug]/settings/domain/page.tsx:81`** — `redirect("https://place.community/es/login")`. Locale `es` literal.
3. **`src/app/(app)/place/[placeSlug]/not-found.tsx:17`** — `href="https://place.community"`. Apex literal sin locale ni slug-awareness.

**Por qué B los toca**: cohesión del commit. Las 3 pages se modifican en S4 para insertar el branch del gate page; arreglar los redirects en el mismo commit evita dejar deuda activa sobre archivos que B ya está tocando. El fix scope:

- Helper nuevo `src/shared/lib/auth-redirect.ts` con `buildOriginalDomainLogin({slug, defaultLocale}): string` que arma `https://${slug}.place.community/${defaultLocale}/login`.
- Las 3 pages se actualizan para usar el helper. El locale viene de `place.default_locale` (ya cargado server-side); el slug viene del param de ruta.
- `not-found.tsx` recibe el slug+locale del layout vía context o props (la page es síncrona, no async — el ajuste exacto se cierra en S4).

**Estos bugs son pre-existentes, no introducidos por B**. El ChangeLog del feature B los registra explícitamente como "fix incidental" — auditoría de redirects hardcoded en pages owner-only.

## Operational risks

1. **Cron safety net (#103) gana importancia post-B**. Escenario: owner registra `nocodecompany.co`, verifica, DNS está correcto, `verified_at = now()`. 2 meses después, el owner cambia de provider DNS y olvida re-configurar. El visitante en custom domain ya NO ve un error DNS — ve **SSL error de Vercel** ("certificate not valid") porque Vercel intenta renovar el certificado y falla. Mientras tanto, `verified_at IS NOT NULL` queda stale en DB; el routing seguiría tirando al place si el TLS handshake llegara, pero NO llega. El owner solo se entera si: (a) un visitante le avisa, o (b) vuelve a `/settings/domain` y el lazy poll dual V9+V6 detecta `misconfigured: true` y resetea `verified_at = NULL` (ADR-0029). **Mitigation V1**: documentar este risk (acá + ADR-0031 §Consecuencias). **Mitigation V1.1**: activar cron `*/15 * * * *` que corre `getCustomDomainStatus` para todas las rows con `verified_at IS NOT NULL AND archived_at IS NULL` y resetea si detecta `misconfigured`. Cron NO es blocker de B, pero post-B la deuda operativa NO se debería diferir indefinidamente.

2. **Connection pool saturation por bot traffic**. Escenario: un bot/crawler que enumera dominios random apuntados a Vercel hits `random-xyz.com` apuntando a la zona del proyecto Place. Cada hit = 1 query Neon. El pool `@neondatabase/serverless` ws default size 10. Si el rate supera el pool sostenidamente, queries esperan + p95 sube. **Mitigation V1**: monitorear vía `getRuntimeLogs` de Vercel + filtros por status. **Mitigation V2**: in-memory TTL cache 60s en module scope del wrapper. Criterio cuantitativo: p95 > 100ms 1h OR rate > 100/min 10min (ADR-0031 §6). El cache hace miss en cold-start del Lambda (no comparte memoria con Lambdas warm) pero hit en hot Lambdas — los hits unknown se concentran en pocos hosts repetidos, el cache amortiza.

3. **Cold start del Lambda no comparte memoria con caches futuras**. Escenario futuro: cuando V2 active cache in-memory, cada Lambda cold-start arranca con cache vacío. **Impacto V1**: ninguno (V1 no tiene cache). **Impacto V2**: documentar en la decisión V2 que el cache NO es global → primera request post-cold-start de cada Lambda dispara la query. Aceptable porque cold-starts son esporádicos y la query es ~5-20ms.

4. **Layout validation cost por request a custom domain**. Escenario: cada request a custom domain dispara: (a) lookup en proxy, (b) lookup en layout (defensive validation). Sin dedup, sería 2 queries físicas. **Mitigation V1**: `React.cache()` envuelve el wrapper → 1 sola query física por request. El layout invoca `lookupPlaceByDomain(host)` con el mismo argumento que el proxy → React deduplica. Precedente en `src/app/(app)/place/[placeSlug]/_lib/get-place-for-zone.ts` (ADR-0031 §5).

5. **Auth gap UX para owners**. Escenario: owner típico V1. Logea en `place.community/login`, navega a `nocodecompany.co/settings` esperando administrar. **Comportamiento V1**: gate page educativo + link al subdomain canónico. **Limitación conocida**: el owner debe hacer 1 click extra para llegar al settings. **Mitigation V1**: copy honesto + UX explícita (ADR-0031 §4). **Cierre estructural**: Feature C (OIDC SSO + JWT host-only + silent SSO via `prompt=none` para owners ya autenticados en apex).

6. **Vercel rate limit en `place_domain` operations** (riesgo lateral de Feature A, no de B directamente). Escenario: registro masivo de dominios en un periodo corto satura el rate limit de Vercel Domains API. **Impacto en B**: ninguno directo (B no consume Vercel API). Lookup es DB-only. Riesgo documentado en ADR-0026.

## Smoke ejecutado 2026-05-22

Smoke programático local contra `pnpm dev` (Next 16.2.6 + Turbopack) con fixture temporal en branch Neon `dev` (`place.slug='smoke-feature-b' default_locale='es'` + `place_domain.domain='smoke.feature-b.example' verified_at=now()`) — el smoke E2E "manual con `/etc/hosts` + browser" del plan original se substituye por `curl -H "Host: ..."` porque el proxy es sensible al **Host header**, no al hostname resuelto por DNS; los 9 escenarios reproducen exactamente las ramas que el smoke manual exploraría. Fixture purgada post-smoke (place + place_domain DELETE; `leftover_places=0` verificado).

| # | Escenario | Esperado | Obtenido |
|---|---|---|---|
| 1 | `Host: place.community` / `/` | 307 → `/es` (intl default-locale redirect, branch marketing) | ✅ 307 → `http://localhost:3000/es` |
| 2 | `Host: place.community` / `/es` | 200 (marketing landing renderiza) | ✅ 200 |
| 3 | `Host: app.place.community` / `/` | 307 → `/es` (intl primero; el rewrite a `/inbox/es` ocurre en el siguiente request del browser) | ✅ 307 → `http://localhost:3000/es` |
| 4 | `Host: smoke-feature-b.place.community` / `/` | 200 (subdomain canon rewrite a `/place/smoke-feature-b/` interno) | ✅ 200 |
| 5 | `Host: smoke.feature-b.example` / `/` (**custom-domain verified**) | 200 (rewrite interno a `/place/smoke-feature-b/`, URL pública intacta) | ✅ 200 |
| 6 | `Host: random-unknown-xyz.example` / `/` | 307 → `/es` (host desconocido → lookup retorna null → marketing fallback fail-safe) | ✅ 307 → `http://localhost:3000/es` |
| 7 | `Host: smoke.feature-b.example` / `/?foo=bar&baz=qux` | 200 (query string preservado en el rewrite) | ✅ 200 |
| 8 | `Host: smoke.feature-b.example` / `/place/otro-slug` (**path manipulation**) | 404 (defensive validation host↔slug en layout dispara `notFound()`) | ✅ 404 |
| 9 | `Host: smoke.feature-b.example` / `/ruta-que-no-existe` | 404 (host-aware not-found de S4e — derivado del Host, no del path) | ✅ 404 |

**Verificación adicional pre-smoke**:

- `pnpm typecheck` ✅ (sin errores)
- `pnpm lint` ✅ (sin warnings ni errors)
- `pnpm test` ✅ 550/550 (53 test files; cubre RLS lookup-by-domain S1, wrapper custom-domain-lookup S2, host-routing async S2, proxy integration S3, layout defensive validation S3, helper auth-redirect S4a/c, gate UI S4d, place-not-found-context S4e — todas las ramas que el smoke ejerce runtime)
- `node scripts/check-translations.mjs` ✅ 0/0 × 5 (257 keys en `es.json`; en/fr/pt/de/ca paridad estricta — incluye `customDomainRouting.authGate.*` de S5 + `placeNotFound.*` de S4e)
- `pnpm build` ✅ (production build pasa; `proxy.ts` async válido en Next 16; el path `/place/[placeSlug]` queda en la build manifest como ƒ Dynamic + ƒ Proxy Middleware reconocido)

**Cobertura de lo que NO se ejerce programáticamente** (queda al smoke production post-push):

- Branch del `<AuthGateForCustomDomain>` (Smoke 5 hit `/`, no `/settings` — el gate sirve cuando `host es custom-domain` AND `path es owner-only` AND `no hay sesión local`; el click del botón viaja al subdomain canon con la sesión apex). Cubierto por unit tests del gate (S4d) + integration tests del settings page (S4c) — el smoke production lo cierra renderizando el page real con cookies/headers de browser.
- Latencia real Neon iad1 → Vercel (Lambda warm vs cold). El smoke local mide ~0–3ms para hot path estructural y ~5–20ms cuando golpea el lookup; production confirma el p95 budget del ADR-0031 §6.
- TLS handshake del custom domain (Vercel managed cert). Sólo relevante post-push (DNS de `nocodecompany.co` apunta a producción).

**Smoke production ejecutado 2026-05-22** (post-push, deploy `dpl_7HYcUAdA3mrdsxhCackGcE4AAeJ4` commit `a1d354f`, target=production, region iad1, build ~43s):

| # | Escenario | Esperado | Obtenido |
|---|---|---|---|
| 1 | `https://nocodecompany.co/` | HTTP 200 + URL intacta + cert válido | ✅ HTTP 200 · `x-matched-path: /place/[placeSlug]` (proxy rewrite a `/place/mi-place/` confirmado) · `<html lang="es">` (default_locale del place resuelto) · SSL Let's Encrypt R12 `CN=nocodecompany.co` válido `notAfter=Aug 20 2026` |
| 2 | Vercel deploy `dpl_*` post-push | state=READY, target=production | ✅ `dpl_7HYcUAdA3mrdsxhCackGcE4AAeJ4` READY (build start `2026-05-22T20:24:18Z` → ready `2026-05-22T20:25:02Z` ≈ 43s; aliases incluyen `nocodecompany.co`, `place.community`, `app.place.community`, `*.place.community`, `www.place.community`) |
| 3 | Neon: `verified_at` de `nocodecompany.co` intacto (no regresión Feature A) | timestamp pre-push preservado | ✅ `2026-05-22T20:19:23.248Z` (idéntico pre-push) · `archived_at=NULL` · slug `mi-place` · default_locale `es` |
| 4 | `https://nocodecompany.co/settings` sin sesión | `<AuthGateForCustomDomain>` localizado en `es` + CTA al subdomain canon | ✅ HTTP 200 · `x-matched-path: /place/[placeSlug]/settings` · title "Iniciá sesión en Place" (key `customDomainRouting.authGate.title` canonical es) · `href="https://mi-place.place.community/settings"` (helper `buildApexAuthFallback` resolvió subdomain canon + returnPath) · `<html lang="es">` |
| 5 | Click CTA → llega al subdomain canon | render del settings o login del apex | 🟡 user-driven (requiere browser + sesión) — flujo confirmado client-side cuando user lo ejecute |
| 6 | `https://mi-place.place.community/settings` con sesión apex | settings normal (no regresión) | 🟡 user-driven (requiere cookie de sesión apex) — flujo cubierto por unit tests del settings page (S4c) + ya estaba READY en producción pre-S6 (último deploy verde `dpl_32MwQLuC8rXDoZFejN9YfjW6cLXr` commit `1dea7b5`) |

**Verificación adicional production**:

- Migrations 0009 (`lookup_place_by_domain`) + 0010 (`lookup_place_locale_by_slug`) aplicadas a la branch `production` por `maybe-migrate.mjs` durante el build ✅ (`pg_proc` confirma ambas presentes).
- `place_domain` de `nocodecompany.co`: `verified_at` y `archived_at` sin cambios pre/post-deploy ✅.
- Defensive-validation slug↔host del layout (S3) cubierta runtime por el path `/place/[placeSlug]` rewriteado — sin signals de error en logs hasta aquí (cualquier mismatch dispararía `notFound()` → HTTP 404, no observado en smoke 1+4).

Escenarios 5–6 son user-driven (browser + auth cookie); su coverage runtime se complete cuando el user navegue la UI. La rama de protocolo (auth gate ↔ subdomain canon ↔ settings con sesión) está cubierta por unit + integration tests + smoke production scenarios 1+4 que prueban el render server-side del gate localizado.

## Pointers

- **ADR canónica V1 de Feature B**: [`docs/decisions/0031-custom-domain-routing-v1.md`](../../decisions/0031-custom-domain-routing-v1.md).
- **ADR precedente Feature A (registro + verificación lazy)**: [`docs/decisions/0026-custom-domain-v1-lazy-verification.md`](../../decisions/0026-custom-domain-v1-lazy-verification.md).
- **ADR promoción del slice anfitrión**: [`docs/decisions/0028-promotion-slice-anfitrion.md`](../../decisions/0028-promotion-slice-anfitrion.md).
- **ADR fix verified-false-positive (lazy poll dual V9+V6)**: [`docs/decisions/0029-lazy-poll-dual-v9-v6.md`](../../decisions/0029-lazy-poll-dual-v9-v6.md).
- **ADR split por capa de operación (`custom-domain` + `custom-domain-verification`)**: [`docs/decisions/0030-split-por-capa.md`](../../decisions/0030-split-por-capa.md).
- **Auth + OIDC + custom domains (canónica macro)**: [`docs/decisions/0001-auth-oidc-custom-domains.md`](../../decisions/0001-auth-oidc-custom-domains.md).
- **Test checklist por sesión**: [`./tests.md`](./tests.md) (S0 del plan).
- **Spec de Feature A (precedente UI)**: [`docs/features/custom-domain/spec.md`](../custom-domain/spec.md).
- **Multi-tenancy update post-B**: [`docs/multi-tenancy.md`](../../multi-tenancy.md) §"Dominios propios" (reescrita en S0 al estado V1 de B).
- **Proxy actual (pre-B, sync)**: `src/proxy.ts`.
- **Host routing puro actual**: `src/shared/lib/host-routing.ts`.
- **Wrapper anonymous-safe (a crearse S2)**: `src/shared/lib/custom-domain-lookup.ts`.
- **Migration 0009 (a crearse S1)**: `src/db/migrations/0009_lookup_place_by_domain.sql`.
- **Slice nuevo (a crearse S4)**: `src/features/custom-domain-routing/public.ts` + `src/features/custom-domain-routing/ui/auth-gate.tsx`.
- **Helper auth-redirect (a crearse S4)**: `src/shared/lib/auth-redirect.ts`.
- **i18n keys (a agregarse S5)**: `customDomainRouting.authGate.{title, body, cta, help}` × 6 locales en `src/i18n/messages/{es,en,pt,de,fr,it}.json`.
- **Paradigma vertical-slice**: [`docs/architecture.md`](../../architecture.md) §17-25.
- **Driver Neon (ws)**: ADR-0018 §"Driver = neon-serverless".
- **`React.cache()` dedup precedente**: `src/app/(app)/place/[placeSlug]/_lib/get-place-for-zone.ts`.
