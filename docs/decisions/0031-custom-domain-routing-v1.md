# 0031 — Custom Domain Routing V1: lookup `SECURITY DEFINER` + proxy async + auth-gate educativo

> **Implementación S0–S6 cerrada 2026-05-22 (post-push, post-smoke production).** Plan de sesiones ejecutado en [`docs/features/custom-domain-routing/plan-sesiones.md`](../features/custom-domain-routing/plan-sesiones.md); smoke programático local 9/9 ✅ + smoke production 4/4 server-side ✅ (5–6 user-driven) documentados en [`docs/features/custom-domain-routing/spec.md` §Smoke ejecutado 2026-05-22](../features/custom-domain-routing/spec.md#smoke-ejecutado-2026-05-22). Vercel deploy `dpl_7HYcUAdA3mrdsxhCackGcE4AAeJ4` (commit `a1d354f`) READY en target=production con migrations 0009 + 0010 aplicadas. Tag final: `baseline/feature-b-done`. Las decisiones de esta ADR quedan vigentes tal cual se aceptaron; este banner sólo asienta el estado de implementación V1.

> **Refinada por ADR-0032 (2026-05-22) — §"Difiere a planes posteriores" §11 (Feature C) OBSOLETA:** la descripción de Feature C como "OIDC SSO desde custom domain: provisioning del `oauth_client_id` + callback handler `/api/auth/callback/place-idp/route.ts` + cookie host-only del custom domain con JWT propio + silent SSO via `prompt=none` para owners ya autenticados en apex" YA NO aplica. Feature C cierra el gap con **Signed Ticket pattern** (ADR-0032): 4 endpoints (`/api/auth/sso-init`, `/api/auth/sso-issue`, `/api/auth/sso-redeem`, `/api/auth/sso-jwks`) + cookie host-only `__Host-place_sso_session` (JWT ES256, NO OIDC formal). **NO** se provisiona client OIDC per dominio (`place_domain.oauth_client_id` queda NULL indefinidamente). **NO** hay callback handler en custom domain (el redeem mismo es el flow completo). El `<AuthGateForCustomDomain>` (Feature B §4) queda **locked** — accesible como CTA fallback dentro del nuevo `<SsoFallbackPanel>` cuando el silent SSO falla. Resto de ADR-0031 sigue vigente (lookup SECURITY DEFINER + proxy async + defensive validation slug↔host).

- **Fecha:** 2026-05-22
- **Estado:** Aceptada
- **Alcance:** routing host-based (`src/proxy.ts` pasa a `async`) · resolución de host (`src/shared/lib/host-routing.ts` gana variante `custom-domain` y wrapper async) · acceso a datos desde el edge sin claim (`app.lookup_place_by_domain` `SECURITY DEFINER`) · slice nuevo `custom-domain-routing` con su `<AuthGateForCustomDomain>` · defensive validation host↔slug en `(app)/place/[placeSlug]/layout.tsx` · sin impacto en producto/UX del owner del slice `custom-domain` (registro + verificación) · sin impacto en la lógica del slice `custom-domain-verification` (lazy poll + helpers)
- **Habilita:** que el visitante de `https://nocodecompany.co/` reciba el contenido del place servido por `(app)/place/{slug}/` sin cambiar la URL del browser (Feature B del roadmap declarado en ADR-0026 §5 y ADR-0028 §"Forward-compat con Features B y C") · que el smoke E2E del feature `custom-domain` deje de cerrarse con "verified pero todavía no rutea" · que Feature C (OIDC SSO desde custom domain, plan separado) tenga un proxy ya async sobre el que colgar el callback handler
- **Refina:** ADR-0026 §5 (forward-compat Feature B con `SECURITY DEFINER`) — esta ADR materializa lo que aquella anticipó y agrega 3 decisiones que ADR-0026 no podía cerrar sin la implementación: (a) shape exacto del payload jsonb del lookup (`place_id` + `slug` + `default_locale`), (b) runtime del proxy (Node confirmado), (c) cobertura del gap de cookie cross-domain en V1 (gate educativo, no redirect ciego). ADR-0001 §"Sesión y SSO" sigue intacta — el modelo OIDC del IdP central se cierra en Feature C.
- **No supersede:** ADR-0001 (Place=IdP, OIDC client por custom domain — se sigue posponiendo a Feature C) · ADR-0010/0012 (RLS owner-only de `place_domain` queda intacta; el lookup es `DEFINER`, no cambia policies) · ADR-0017 (provisioning por migraciones) · ADR-0024 (i18n fallback runtime — el gate page consume `getTranslations` igual que el resto) · ADR-0026/0028/0029/0030 (slices `custom-domain` y `custom-domain-verification` no se tocan en B) · ADR-0022 (i18n DB-based del place — el gate page resuelve copy con `place.default_locale` vía lookup del proxy, idéntico al settings)
- **Difiere a planes posteriores:**
  - **Feature C — OIDC SSO desde custom domain**: provisioning del `oauth_client_id` (queda NULL post-B igual que post-A) + callback handler `/api/auth/callback/place-idp/route.ts` montado sobre el custom domain + cookie host-only del custom domain con JWT propio + silent SSO via `prompt=none` para owners ya autenticados en apex. Cierra el auth gap completamente.
  - **V2 cache layer del lookup**: in-memory TTL cache 60s si en producción p95 latencia del proxy > 100ms OR request rate > 100/min sostenido (criterio cuantitativo abajo).
  - **V2 multi-domain por place**: ADR-0026 ya documenta el path; V1 routing asume 1 fila activa por place (alineado con el constraint del registro).
  - **Cron safety net** (#103, S6 V1.1 del feature `custom-domain`): pendiente desde ADR-0026 §1; **post-B su importancia aumenta** — si el owner no vuelve a `/settings/domain` después de configurar DNS y el DNS se rompe, el visitante en custom domain ve SSL error de Vercel mientras `verified_at IS NOT NULL` queda stale. Ver §Consecuencias.

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

ADR-0026 (2026-05-21) cerró Feature A V1 (registro + verificación lazy de custom domains) y dejó explícitamente diferido a Feature B el host routing real:

> §5 — "Feature B (`docs/features/custom-domain-routing/` futura) modificará `src/shared/lib/host-routing.ts` para resolver `mi-place.com → place` vía lookup en `place_domain`. **El proxy edge corre SIN claim de sesión** … RLS owner-only sobre `place_domain` filtraría a 0 rows. La solución prevista (no se implementa en V1, sólo se documenta): una función Postgres `app.lookup_place_by_domain(host text) RETURNS jsonb` con `SECURITY DEFINER` que retorna `{place_id, slug, verified}` sin requerir claim. El proxy la invoca como cliente anónimo gateado por la propia función."

Tras Feature A + polish #110/#111/#112 (deployed `1dea7b5`, 2026-05-22), el owner registra `nocodecompany.co` y la UI lo muestra **verified con SSL activo**. Pero al visitar `https://nocodecompany.co/` el visitante cae a la **landing de marketing** (`src/shared/lib/host-routing.ts:resolveHost` retorna `marketing` para hosts desconocidos como fail-safe — nunca servir el place de otro en un host ajeno). La promesa "verificado, próximamente vas a poder usarlo como acceso directo a tu place" (copy del estado verified del `<DomainSection>`) queda sin cumplirse.

Lo que ADR-0026 NO podía cerrar y esta ADR cierra:

1. **Shape exacto del payload jsonb del lookup.** ADR-0026 sugiere `{place_id, slug, verified}` pero verified ya está implícito en el predicado (`WHERE verified_at IS NOT NULL`), y para el gate page (decisión §3) necesitamos también `default_locale`. La elección de shape impacta el contrato del proxy + layout + gate page; cerrarla ahora evita refactors en S2.

2. **Runtime del proxy.** ADR-0026 escribe "proxy edge" porque al momento de ese análisis el repo no había sido auditado para confirmar Node vs Edge runtime. Next 16 default es Node (Fluid Compute) salvo `export const runtime = 'edge'` explícito; la verificación del `src/proxy.ts` actual es necesaria antes de elegir driver Neon (ws para Node, http para Edge). El plan de Feature B incluye **gating step** en S2 que materializa lo de esta ADR.

3. **Auth gap UX en V1.** La cookie Neon Auth `Domain=.place.community` no acompaña custom domains (cookie host-only por dominio, decisión externa del navegador). En V1 — sin OIDC SSO — un owner que visita `https://nocodecompany.co/settings/` no tiene sesión local. Tres opciones realistas:
   - **(a) Redirect ciego al subdomain canónico**: `redirect("https://{slug}.place.community/settings")`. Funciona técnicamente pero genera UX confusa — el owner queda "rebotado" sin entender por qué; si el owner intenta navegar otra vez al custom domain el rebote se repite (loop perceptual aunque no técnico).
   - **(b) Gate page educativa** con copy localizado en `place.default_locale` + botón explícito al subdomain canónico (canon-link UX). El owner entiende qué pasa, click → llega al login del apex, sesión apex levanta, vuelve al custom domain como visitante anónimo.
   - **(c) Servir el contenido público + ocultar `/settings`**: rompe la consistencia "URL del browser = lo que el usuario pidió" — el owner que typea `/settings` no debe ver una página distinta a settings sin explicación.
   
   La (b) es la que respeta el principio de honestidad UX del producto (ADR-0022 §"feedback loops calmos") y le da al owner el control de la transición. Las (a) y (c) crean asymmetric mental models.

4. **Defensive validation slug↔host.** Si por bug del proxy o por manipulación interna (e.g. atacante con acceso a un endpoint que rewrites internamente) un request con host `nocodecompany.co` llega a `(app)/place/otro-slug/...`, el layout debería rechazar — no servir el place ajeno. ADR-0026 §RLS asume `loadPlaceBySlug` filtra owner-only, pero si la query es **anónima** (no hay sesión, gate page), RLS no aplica. Defensa-en-profundidad pide que el layout valide independientemente del proxy.

5. **Cost budget del lookup.** Cada request a host desconocido = 1 query Neon iad1. Sin cache V1. Bot traffic random podría saturar el pool. Decidir criterio cuantitativo de cuándo agregar cache (V2), no criterio cualitativo "si parece lento".

6. **Pre-existing bugs en redirects.** Auditando los pages owner-only (`settings/page.tsx:76`, `settings/domain/page.tsx:81`, `not-found.tsx:17`) aparece un patrón de redirects hardcoded a `https://place.community/es/login` — locale **es** literal y apex genérico. No causa bug en V1 (apex login funciona, locale español es el default razonable) pero al introducir custom domains la UX de "rebotar al apex genérico cuando el owner viene de su propio dominio" empeora. Feature B toca esas 3 pages en S4; arreglarlo en el mismo commit cohesiona el cambio.

Esta ADR cierra las 6 antes de empezar la implementación V1 de Feature B.

## Decisión

### 1. Lookup `SECURITY DEFINER` con payload jsonb `{place_id, slug, default_locale}`

Migración 0009 crea una función Postgres:

```sql
CREATE OR REPLACE FUNCTION app.lookup_place_by_domain(p_host text)
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'place_id', p.id,
    'slug', p.slug,
    'default_locale', p.default_locale
  )
  FROM place_domain pd
  JOIN place p ON p.id = pd.place_id
  WHERE lower(pd.domain) = lower(p_host)
    AND pd.verified_at IS NOT NULL
    AND pd.archived_at IS NULL
    AND p.archived_at IS NULL
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION app.lookup_place_by_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lookup_place_by_domain(text) TO "app_system";
```

**Justificación del shape**:
- `place_id`: lo necesita Feature C (callback handler) y posibles features futuras que vinculen logs/audit al place sin re-resolver el slug.
- `slug`: lo necesita el proxy para rewrite (`/place/{slug}{rest}`) y el layout para defensive validation.
- `default_locale`: lo necesita el gate page (decisión §3) para renderizar copy en el locale del place sin una 2da query. Espeja ADR-0022 (i18n DB-based del settings) — el locale del custom domain es el del place, no negociado por path/Accept-Language.

**Justificación del patrón DEFINER**: el proxy corre sin claim de sesión (es el primer hop, antes del handshake con el Server Component). RLS owner-only sobre `place_domain` (ADR-0012) filtraría a 0 rows. La función `STABLE SECURITY DEFINER` con `search_path` fijo es el mismo patrón canónico de `app.create_place` (ADR-0012 §3) y `app.accept_invitation` (ADR-0010 §RLS e invitaciones). Dueño: `neondb_owner` (el rol privilegiado de migraciones). EXECUTE solo `app_system` (custom NO-admin, sin `BYPASSRLS`). REVOKE explícito de PUBLIC.

**Predicados**: `lower(pd.domain) = lower(p_host)` (case-insensitive — DNS es case-insensitive; el registro normaliza a lowercase pero defensa-en-profundidad). `verified_at IS NOT NULL` (no rutear pending). `pd.archived_at IS NULL` (archived libera el dominio, no debe rutear). `p.archived_at IS NULL` (places tombstoneados no se sirven, ADR-0003).

**Por qué `STABLE` y no `IMMUTABLE`**: la función lee la tabla `place_domain`, que es mutable (verifies, archives). `IMMUTABLE` sería incorrecto y rompería el query planner si Postgres cache-eara resultados.

**Por qué `RETURNS jsonb` y no row-set**: el caller (Node wrapper) recibe un valor escalar parseable, sin manejar columns/rows. Si el host no matchea, retorna `NULL` (un solo NULL escalar) — el wrapper retorna `null` directo sin chequear length. API más simple que `RETURNS TABLE`.

**Por qué `LIMIT 1`**: el partial unique index `(domain) WHERE archived_at IS NULL` (ADR-0026 §2) garantiza unicidad de filas activas, pero `LIMIT 1` es defensa-en-profundidad por si el constraint se viola por bug (mejor servir un place que tirar 500).

### 2. Proxy `async` con variante `custom-domain` en `HostZone`

`src/proxy.ts` (sync hoy) pasa a `async function proxy(req)`. La función pura `resolveHost(host, root?)` SYNC queda **intacta** (backward compat); se agrega un wrapper async `resolveHostWithCustomDomains(rawHost, rootHost?, lookup?): Promise<HostZone>` que:

1. Llama `resolveHost(rawHost, rootHost)` sync para clasificar marketing/inbox/place/desconocido.
2. Si el resultado es `marketing` Y el host **no** es apex ni `www.<root>` ni `*.vercel.app` ni `localhost`/`*.localhost` (heurística pura, sin query DB) → llama al `lookup` injectado.
   - Si lookup retorna `{place_id, slug, default_locale}` → retorna `{ zone: "custom-domain", placeId, slug, defaultLocale }`.
   - Si lookup retorna `null` o throws → retorna `{ zone: "marketing", ... }` (fail-safe; el visitante ve la landing en vez de un 500).
3. Else (no candidato a custom domain) → retorna lo que dijo `resolveHost` sync sin tocar DB.

El proxy ramifica:

```ts
if (target.zone === "custom-domain") {
  const url = req.nextUrl.clone();
  url.pathname = `/place/${target.slug}${req.nextUrl.pathname}`;
  return NextResponse.rewrite(url);
}
```

Preserva query string (`req.nextUrl.searchParams` quedan en el clone). Preserva cookies/headers (rewrite NO crea response nueva). NO invoca `intlMiddleware` (el i18n del custom domain es DB-based, ADR-0022 / decisión §3 abajo) — distinto al composing del Hub donde sí se invoca next-intl.

**Branch order en proxy**: marketing → inbox → place → custom-domain. El wrapper async tiene la fail-safe semantics — custom-domain SIEMPRE se evalúa antes de devolver marketing definitivo. El branch `if (zone === "custom-domain")` rewrite va antes de `intlMiddleware` (que es solo marketing/inbox).

**`HostZone` discriminated union** (`src/shared/lib/host-routing.ts`):

```ts
type HostZone =
  | { zone: "marketing" }
  | { zone: "inbox" }
  | { zone: "place"; slug: string }
  | { zone: "custom-domain"; placeId: string; slug: string; defaultLocale: string };
```

Typecheck exhaustivo en proxy + layout fuerza handle de los 4 casos.

### 3. Runtime decision: **Node confirmado**; Edge sería fallback documentado

Auditoría del repo (verificada en planning de Feature B, 2026-05-22):
- `src/proxy.ts` no declara `export const runtime`.
- `next.config.ts` no override de runtime.
- Default Next 16 = Node (Fluid Compute) para proxy/middleware.

**Decisión**: el wrapper `src/shared/lib/custom-domain-lookup.ts` usa `pool` de `@neondatabase/serverless` (WebSocket, ws driver) — el canon del repo en `src/db/client.ts` (ADR-0018 §"Driver = neon-serverless"). Encaja perfecto en Node runtime.

**Si en futuro Next o Vercel fuerzan Edge runtime para proxy** (improbable; Fluid Compute es el path declarado por Vercel post-2025): cambiar el wrapper al driver HTTP (`@neondatabase/serverless` exporta `neon` con HTTP fetch, no requiere ws). Detalle:

```ts
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const result = await sql`SELECT app.lookup_place_by_domain(${host})`;
```

`neon()` HTTP no soporta transacciones interactivas, pero el lookup es 1 query escalar sin tx — encaja. Driver swap = 1 file modificado (~15 LOC). Documentado acá para que no requiera nueva ADR cuando aparezca.

**Gating step** (operacionalizado en plan S2 de Feature B): antes de escribir el wrapper, re-verificar runtime del proxy. Si cambió → ajustar driver. Si no → seguir con ws.

### 4. Auth gap UX V1: `<AuthGateForCustomDomain>` server component con canon-link al subdomain

Pages owner-only bajo custom domain (`/settings`, `/settings/domain`) detectan custom domain con heurística pura `isCustomDomainHost(host, slug, rootHost)` (no consulta DB — la consulta ya ocurrió en el proxy + layout) y, si no hay sesión local:

1. Resolver `defaultLocale` del place via `lookupPlaceByDomain(host)` (anonymous-safe; el layout y proxy ya lo dispararon — `React.cache()` deduplica intra-request → 1 sola query física).
2. Render `<AuthGateForCustomDomain slug={placeSlug} defaultLocale={...} returnPath={...} />` (Server Component del slice nuevo `custom-domain-routing`).
3. El gate page muestra copy localizado en `place.default_locale`:
   - **Title**: "Iniciá sesión en Place"
   - **Body**: "Para administrar **{slug}** tenés que iniciar sesión en su dirección original en Place. Esta URL es la cara pública del lugar para tus visitantes."
   - **CTA primary**: link visible (no auto-redirect) a `https://{slug}.place.community/{defaultLocale}{returnPath}`.
   - **Help**: "Mientras tanto, tus visitantes pueden seguir usando este dominio normalmente."

**Por qué link y no auto-redirect**: el owner ve por qué tiene que cambiar de URL y elige el momento. Si el browser bloqueara cookies cross-site o el owner cerró sesión deliberadamente, un auto-redirect generaría un loop perceptual ("¿por qué me lleva al otro dominio?"). El link explícito respeta la agency del owner.

**Pages anonymous-allowed** (root del place `(app)/place/[placeSlug]/page.tsx`): NO necesitan gate. El placeholder "Este lugar está casi listo" se sirve idéntico en subdomain canónico y custom domain — UX correcta para visitantes en custom domain pre-Feature C.

**Locale del gate page**: SIEMPRE `place.default_locale` (no negociación con `Accept-Language`). Decisión espeja ADR-0022 para el settings — el chrome del place tiene un locale propio que el owner editó conscientemente; el gate page **es chrome del place visto desde su dominio**, no marketing genérico.

### 5. Defensive validation slug↔host en `(app)/place/[placeSlug]/layout.tsx`

El layout obtiene `headers().get('host')` y:

1. Si el host es apex / `*.place.community` / `localhost` / `*.localhost` / `*.vercel.app` → no chequea (los rewrites a `/place/{slug}` desde subdomain canónico son trusted; resolved por proxy + middleware).
2. Else → llama `lookupPlaceByDomain(host)` (anonymous-safe).
   - Si retorna `null` → `notFound()`. El host es un custom domain unknown que de alguna manera llegó al layout — bug del proxy o manipulación interna; no servir nada.
   - Si retorna `{slug: lookupSlug, ...}` y `lookupSlug !== placeSlug` (el slug del param de la ruta) → `notFound()`. Mismatch host↔slug; no servir el place ajeno.
   - Si retorna `{slug: lookupSlug, ...}` y matchea → continuar normalmente.

**`React.cache()` dedup intra-request**: el proxy YA llamó `lookupPlaceByDomain(host)` para decidir el rewrite. El wrapper se envuelve en `React.cache()` (mismo patrón que `getPlaceForZone` en `_lib/get-place-for-zone.ts`). El layout invoca la misma función con el mismo arg → **0 queries físicas extra** dentro del request. Sólo en cross-request o en custom-domain edge case el layout dispara una query nueva.

**Por qué en el layout y no en cada page**: el layout es el primer Server Component que ve `placeSlug` resuelto + tiene acceso a `headers()`. Centralizar acá significa que CUALQUIER page bajo `(app)/place/[placeSlug]/*` (existentes + futuros) hereda la defensa sin acoplarla a cada page.

**Bajo riesgo, alta defensa**: el costo (1 query intra-request, deduplicada por React) es bajo. El payoff (defensa contra rewrite manipulation, observabilidad si algo va mal) es alto y documentado.

### 6. Cost budget del lookup + criterio cuantitativo para cache V2

**V1 sin cache**. Cada request a host desconocido = 1 query Neon iad1 (~5-20ms con co-location, `preferredRegion = "iad1"`). El pool `@neondatabase/serverless` ws default size 10 absorbe el throughput esperable de un MVP (low traffic, bot/crawler hits esporádicos).

**Criterio cuantitativo V2 cache** (in-memory TTL):
- **Trigger A**: p95 latencia del proxy > 100ms sostenido durante 1h (medido vía `getRuntimeLogs` de Vercel + filtros por status code).
- **Trigger B**: request rate al proxy > 100/min sostenido durante 10min (volumen que satura el pool con queries lookup en hot path).
- **Trigger C** (cualitativo, escape hatch): owner reporta "el dominio rutea lento la primera vez del día".

Cualquiera de los 3 → activar V2. Implementación V2 = `Map<host, {result, expiry}>` en module scope del wrapper + TTL 60s + invalidación implícita al expirar (sin webhook por archived; el TTL corto cubre cambios). Detalle de V2 en future ADR-0033+ cuando se justifique en producción.

**Por qué sin cache V1**: YAGNI. La complejidad de cache (race conditions, invalidation, stale data when owner archives, cold-start del Lambda no comparte memoria con Lambdas warm) no se justifica para volúmenes MVP. Si V1 sufre, activar V2 es 1 sesión de trabajo.

### 7. Fix de bugs pre-existentes como parte de S4

Auditando `(app)/place/[placeSlug]/`:

1. `settings/page.tsx:76` — `redirect("https://place.community/es/login")`. Locale `es` hardcoded.
2. `settings/domain/page.tsx:81` — idem.
3. `not-found.tsx:17` — `href="https://place.community"` apex literal.

V1 (pre-B) NO causan bug funcional (apex login funciona, español es default razonable). Pero post-B introducen UX confusa: un owner en `nocodecompany.co` sin sesión va a su settings → rebote al apex en español aunque su place esté en alemán.

**Fix scope de B**: helper nuevo `src/shared/lib/auth-redirect.ts` con `buildOriginalDomainLogin({slug, defaultLocale})` que arma `https://{slug}.place.community/{defaultLocale}/login`. Los 3 pages se actualizan en S4 (que ya los toca para el gate). Cohesión del commit: "el redirect canónico desde owner-only sin sesión".

Estos bugs son **pre-existentes**, no introducidos por B. La ADR los registra para que el ChangeLog del feature B refleje honestamente lo que tocó y por qué.

## Alternativas rechazadas

### A1. Cache in-memory desde V1

Discutida en planning y descartada por YAGNI. El cost del lookup no es prohibitivo (Neon iad1 ~5-20ms; preferredRegion alinea). El owner típico no genera N hits/segundo sobre su custom domain — el bot/crawler traffic es esporádico. La complejidad de cache (invalidación al archived, race con verified, cold-start no comparte memoria) excede el beneficio en V1. Criterio cuantitativo (decisión §6) define V2 trigger.

### A2. Auto-redirect ciego al subdomain canónico (sin gate page)

Discutida en planning. El comportamiento más simple (`if (custom-domain && !session) redirect(subdomain)`) parece atractivo pero rompe la agency del owner: el owner que typea su propio dominio NO espera ser rebotado sin explicación. Si la cookie cross-site se bloqueó (Safari ITP, Firefox ETP), el rebote no resuelve nada — el owner llega al subdomain, intenta volver a su dominio, vuelve a ser rebotado. Loop perceptual aunque no técnico. Gate page con link explícito = owner entiende + tiene el control.

### A3. Servir contenido público de `/settings` (404 disfrazado)

Descartada. Romper "URL del browser = lo que el usuario pidió" mina trust. El owner que typea `/settings` debe ver una página coherente con esa intención (gate page explicando) o un 404 honesto, NO una página distinta sin explicación.

### A4. Webhook Vercel para domain status events (en lugar de lazy poll + lookup)

Mismo argumento de ADR-0026 §"Alternativas rechazadas": Vercel hoy no expone webhook events para domain status, sólo para deployments. Si en futuro lo agrega, swap del lazy poll + cache es 1 sesión. La decisión de B (lookup directo a DB) es independiente del polling — la DB es SoT local; B no consume Vercel API.

### A5. Eliminar el routing sync (`resolveHost`) y hacer todo `resolveHostWithCustomDomains` async

Descartada por backward compat + test surface. `resolveHost` SYNC tiene tests existentes (`host-routing.test.ts`) que NO necesitan async. Mantener ambos preserva el contrato; el wrapper async LLAMA al sync internamente. Cero regresión, doble cobertura.

### A6. Persistir el resultado del lookup en una cookie del response

Descartada. Cookie cross-domain no se setea (el proxy responde con `rewrite`, no `redirect`; el cookie sería del custom domain). Y si se seteara, sería invalidable por archived → mismo problema que cache pero con menos control. Lookup en cada request es más simple y consistente.

### A7. Routing por header `X-Forwarded-Host` en vez de `Host`

Descartada por Vercel behavior. Vercel pasa el host original via `Host` header; `X-Forwarded-Host` no es estable cross-platforms ni semánticamente diferente para este caso. `resolveHost` ya consume `Host` (canon).

### A8. Defensive validation en cada page bajo `/place/[placeSlug]/*` (no en layout)

Descartada por DRY + future-proof. Si la validation vive en cada page, cualquier page futuro (e.g. `/place/[placeSlug]/[zone]/`, `/place/[placeSlug]/thread/[id]/`) requiere remember de re-aplicar el chequeo. Centralizando en layout, el sistema es **fail-safe by default** — un page nuevo hereda la defensa sin acoplarla.

### A9. Pasar `defaultLocale` por header del rewrite (en vez de re-lookup desde el gate page)

Descartada. Headers del rewrite no son confiables (algunas plataformas los strip; consumer-side requiere parseo); el lookup deduplicado por `React.cache()` es **0 queries físicas extra** en la práctica. Optimización irrelevante.

### A10. Renombrar el slice `custom-domain-routing` a `custom-domain-host` o `host-routing`

Descartada. `custom-domain-routing` captura mejor el dominio del slice: rutea custom domains hacia el contenido del place + gestiona el gate UX educativo. Distinto a `host-routing.ts` (puro, shared/lib) y a `custom-domain` (commands + UI) y a `custom-domain-verification` (lazy poll). Nombre coherente con la familia.

## Consecuencias

### Inmediatas (al cerrar S6 de Feature B)

- `nocodecompany.co` (custom domain verified) → sirve `(app)/place/mi-place/page.tsx` (placeholder "Este lugar está casi listo") con URL `https://nocodecompany.co/` intacta en el browser. Promesa del estado verified del `<DomainSection>` cumplida.
- `nocodecompany.co/settings` → renderea `<AuthGateForCustomDomain>` con copy en `place.default_locale` y link al subdomain canónico. Sin loop, sin redirect ciego.
- `nocodecompany.co/settings/domain` → idem.
- Subdomain canónico `mi-place.place.community` y apex `place.community` → comportamiento idéntico al pre-B (no regresión, locked por tests + proxy.test.ts integration).
- Hosts random / unknown → fallback marketing (no rompe, no DDoS DB — el wrapper retorna marketing on lookup-null).
- 3 bugs pre-existentes (locale `es` hardcoded en 2 redirects + apex `place.community` hardcoded en 1) corregidos en el mismo commit del gate (S4) — cohesión + cero deuda pendiente.

### Forward-compat con Feature C (OIDC SSO desde custom domain)

- `app.lookup_place_by_domain` ya retorna `place_id` → Feature C lo usa para resolver el OIDC client de ese place sin re-query.
- Proxy ya es `async` → Feature C agrega el callback handler `/api/auth/callback/place-idp/route.ts` sin tocar el shape del proxy.
- Gate page del slice `custom-domain-routing` queda como path "sesión local todavía no existe" — al cerrarse Feature C el copy/CTA evoluciona (probablemente botón "Iniciar sesión" → silent SSO con `prompt=none`). Cero refactor estructural.

### Forward-compat con cron safety net (#103) — importancia AUMENTA post-B

ADR-0026 §1 dejó el cron `*/15 * * * *` como opcional V1.1, justificado en "si lazy poll cubre 99% de casos en producción". **Post-B la importancia técnica del cron sube**:

- **Escenario que post-B se vuelve problemático**: owner registra dominio → lo verifica (lazy poll de S4) → DNS está correcto → `verified_at = now()`. 2 meses después, el owner cambia de provider DNS y olvida re-configurar el record. El visitante en custom domain ya NO ve un error de DNS — ve **SSL error de Vercel** ("certificate not valid") mientras `verified_at IS NOT NULL` queda stale en DB. El owner solo se entera si: (a) un visitante le avisa, o (b) vuelve a `/settings/domain` y el lazy poll detecta el `misconfigured: true` y resetea (ADR-0029).
- **Mitigation V1 (post-B)**: documentar el risk en este ADR (acá) + en spec de B (sección §"Operational risks") + sugerir #103 como follow-up necesario en el roadmap. Si en producción se observa una sola instancia del escenario, activar #103.
- **Mitigation V2**: cron `*/15` corre `getCustomDomainStatus` para todas las rows con `verified_at IS NOT NULL AND archived_at IS NULL` en background. Detecta `misconfigured: true` y resetea `verified_at` antes de que el visitante vea SSL error.

Cron no es blocker de B, pero post-B se convierte en deuda operativa que NO se debería diferir indefinidamente.

### Cost budget en steady state

- 1 query Neon iad1 por request a host non-trivial (non-apex, non-subdomain canónico, non-localhost). Pool ws default 10, throughput esperable de MVP no satura.
- Layout dedup intra-request: 0 queries físicas extra en custom-domain branch (React.cache).
- Gate page dedup intra-request: idem.
- Cron + smoke MCP post-deploy verifican que `verified_at` de domains pre-existentes (e.g. `nocodecompany.co`) no se altera.

### Cookie cross-domain gap (limitación V1 conocida)

Documentada explícitamente: owners autenticados en `place.community` NO tienen sesión local en `nocodecompany.co`. El gate UX (decisión §4) es el cierre V1 del gap; el cierre estructural es Feature C (OIDC SSO + JWT host-only del custom domain).

### Política a futuro

- **Multi-domain V2**: cuando `place_domain` permita N filas activas por place (ADR-0026 §3), el lookup retorna la primera (LIMIT 1) — el routing se mantiene. Si V2 requiere "default domain" semántico, agregar columna `is_default boolean` y el lookup ordena por `is_default DESC NULLS LAST`. Cambio aditivo.
- **Cache V2**: ver §6.
- **Edge runtime fallback**: ver §3.

## Detalle operativo canónico

- **Migration 0009** (`SECURITY DEFINER` function): `src/db/migrations/0009_lookup_place_by_domain.sql` (S1 del plan B).
- **Wrapper anonymous-safe**: `src/shared/lib/custom-domain-lookup.ts` (S2 del plan B).
- **Variante async de host-routing**: `src/shared/lib/host-routing.ts` (S2, agrega `resolveHostWithCustomDomains` + `HostZone.custom-domain`).
- **Proxy async**: `src/proxy.ts` (S3 del plan B).
- **Defensive validation**: `src/app/(app)/place/[placeSlug]/layout.tsx` (S3 del plan B).
- **Gate page**: `src/features/custom-domain-routing/ui/auth-gate.tsx` (S4 del plan B).
- **Slice public**: `src/features/custom-domain-routing/public.ts` (S4 del plan B).
- **Auth-redirect helper + fix bugs preexistentes**: `src/shared/lib/auth-redirect.ts` + modificaciones en `settings/page.tsx` + `settings/domain/page.tsx` + `not-found.tsx` (S4 del plan B).
- **i18n keys** del gate (`customDomainRouting.authGate.{title,body,cta,help}` × 6 locales): `src/i18n/messages/{es,en,fr,pt,de,ca}.json` (S5 del plan B).
- **Feature spec**: `docs/features/custom-domain-routing/spec.md` (S0 del plan B).
- **Tests checklist**: `docs/features/custom-domain-routing/tests.md` (S0 del plan B).
- **Multi-tenancy update**: `docs/multi-tenancy.md` §"Dominios propios" reescrita post-B (S0 del plan B).

## Pointers

- **ADR original que diferió Feature B**: ADR-0026 (custom domain V1 lazy verification).
- **ADR de promoción del slice anfitrión**: ADR-0028.
- **ADR del fix verified-false-positive**: ADR-0029 (lazy poll dual V9+V6).
- **ADR del split por capa de operación**: ADR-0030 (`custom-domain` + `custom-domain-verification`).
- **Auth + OIDC + custom domains (canónica macro)**: ADR-0001.
- **RLS + función de identidad**: ADR-0010/0011/0012.
- **i18n DB-based**: ADR-0022.
- **Slug inmutable**: `docs/multi-tenancy.md` §"Slug inmutable".
- **Paradigma vertical-slice**: `docs/architecture.md` §17-25.
- **Cap LOC**: `CLAUDE.md` §"Límites de tamaño" — slice `custom-domain-routing` proyectado ~200 LOC (gate UI + barrel + tests).
- **Driver Neon (ws)**: ADR-0018 §"Driver = neon-serverless".
- **`React.cache()` dedup**: precedente en `src/app/(app)/place/[placeSlug]/_lib/get-place-for-zone.ts`.
