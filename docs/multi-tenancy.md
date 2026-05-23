# Multi-tenancy: routing por subdomain

Cada place tiene su propia URL con subdomain. La estructura de URLs refuerza la ontología de "lugar" vs "app".

## Estructura de URLs

| URL                            | Qué es                                                                 |
| ------------------------------ | ---------------------------------------------------------------------- |
| `place.community`                    | Landing pública del producto                                           |
| `app.place.community`                | Inbox universal del usuario (DMs, lista de places a los que pertenece) |
| `{slug}.place.community`             | Portada del place con ese slug                                         |
| `{slug}.place.community/{zone}`      | Zona del place (conversations, events, etc)                            |
| `{slug}.place.community/thread/{id}` | Discusión individual                                                   |
| `{slug}.place.community/settings`    | Configuración del place (solo owner)                                   |

> El slug de URL `thread` es **deliberado**: técnico/universal en la ruta, mientras el objeto canónico de producto es **Discusión** (`docs/ontologia/conversaciones.md`). Consistente con "código en inglés, docs/UI en español" (`CLAUDE.md`). Un barrido de consistencia no debe "corregir" esto.

> **Estado (S7, implementado 2026-05-18 — ADR-0005 §10):** el routing host-based está implementado en `src/proxy.ts` (Next 16 renombró `middleware.ts`→`proxy.ts`, ADR-0013). El apex `place.community` sirve la landing/onboarding con i18n bajo `[locale]`; `{slug}.place.community` sirve el place (placeholder hasta S5b: gate estructural `isServiceableSlug`, resolución por DB en S5b); `app.place.community` sirve el Hub con i18n bajo `[locale]`. El i18n de next-intl se **integra** (no se duplica): el proxy delega en su middleware en la zona marketing **y en la zona Hub** (S5a del Hub V1, 2026-05-20).

## Implementación en Next.js

`src/proxy.ts` (raíz de `src/`, NO `src/app/`) inspecciona el `host` de cada request. La clasificación pura vive en `src/shared/lib/host-routing.ts` (`resolveHost`, unit-testeada sin red/DB):

- subdomain `app` → zona **Hub** (S5a/S5b/S5c del Hub V1, 2026-05-20 — antes "inbox"; el slice y los paths internos siguen llamándose `inbox` por razones históricas, el producto se renombró a Hub al integrar i18n).
- subdomain `www` / apex / `localhost` / `*.vercel.app` / host desconocido → zona **marketing** (los custom domains se resuelven por `place_domain` verificado en una feature posterior; hasta entonces el fallback seguro es marketing — nunca servir el place de otro en un host ajeno).
- cualquier otro subdomain → zona **place** con ese slug (normalizado a minúsculas).

**Rewrite con prefijo estático (decisión de implementación, S7).** Next prohíbe dos segmentos dinámicos con nombres distintos en la misma posición de URL **aunque estén en route groups distintos** — `(marketing)/[locale]` y `(app)/[placeSlug]` no pueden coexistir en la raíz. El proxy resuelve esto reescribiendo a un path con **prefijo estático interno**: place → `/place/{slug}{path}`, Hub → `/inbox/{locale}{path}`; marketing delega en el middleware i18n (`/` → `/{locale}`). El prefijo lo pone el proxy, **nunca aparece en la URL pública** → "URLs públicas = subdominio" se mantiene intacto.

**Composición intl en la zona Hub (S5a del Hub V1, 2026-05-20).** El Hub también tiene i18n always-prefix bajo `[locale]` (mismo patrón que marketing — UX consistente con la landing/onboarding). El proxy lo compone: cuando el host es `app.*`, primero corre el `intlMiddleware` de next-intl (que negocia el locale por path / cookie `NEXT_LOCALE` / `Accept-Language`) y después reescribe `/{locale}{path}` → `/inbox/{locale}{path}` para el route-group `(app)`. La cookie `NEXT_LOCALE` se comparte cross-subdomain (apex↔app); la decisión empírica de fijar `localeCookie.domain = ".place.community"` o no se toma en el smoke de S5c (si no persiste automáticamente, mini-commit aparte).

Estructura de rutas (real, post-S5a del Hub V1):

```
src/app/
├── (marketing)/[locale]/   apex place.community (i18n always-prefix)
│   ├── layout.tsx          <html> raíz de la zona marketing
│   ├── page.tsx            landing
│   ├── not-found.tsx
│   ├── login/ terminos/ privacidad/ crear/
├── (app)/                  zona autenticada (multi-root layout)
│   ├── inbox/[locale]/     ← app.place.community/{locale} (proxy: /inbox/{locale})
│   │   ├── layout.tsx      <html> raíz de la zona Hub
│   │   └── page.tsx        Hub V1 (vista "Tus lugares")
│   └── place/[placeSlug]/  ← {slug}.place.community (proxy: /place/{slug})
│       ├── layout.tsx      <html> raíz de la zona place
│       ├── not-found.tsx   404 de slug no servible / inexistente
│       └── page.tsx        + futuros [zone]/ thread/[id]/ settings/ (S8+)
├── api/                    route handlers (auth; webhooks/cron — a definir)
└── globals.css

src/proxy.ts                 # host-based + delega i18n en marketing Y Hub
src/shared/lib/host-routing.ts  # resolveHost / isServiceableSlug (puro)
```

> Route groups (`(marketing)`/`(app)`) NO aparecen en la URL. Sin `app/layout.tsx` único: cada sub-grupo (`(marketing)/[locale]`, `(app)/inbox/[locale]`, `(app)/place/[placeSlug]`) provee su propio `<html>` (multi-root layout de Next 16). La resolución real del place por DB (`{slug}` inexistente → 404) entra en S5b+ del place (no del Hub); el patrón de streaming agresivo del shell entra con los datos.

## Zona Hub (`app.place.community`)

URL canónica del usuario logueado: `https://app.place.community/{locale}/` (y futuras sub-vistas `/{locale}/dms`, `/{locale}/actividad`, en el roadmap). El Hub V1 (S1-S5 del plan, 2026-05-20) sirve **una sola vista**: "Tus lugares" — la lista de places del que el caller es miembro, con su shell de navegación (sidebar mobile-first + drawer + topbar con menú de cuenta).

- **Path interno**: `(app)/inbox/[locale]/page.tsx`. El nombre `inbox` es histórico del slice (S1 lo provisionó como "inbox universal"); el producto se renombró a "Hub" al integrar i18n en S5a sin tocar el slice (preservar costo de refactor). La URL pública nunca expone "inbox".
- **i18n**: namespaces `inbox` (vista) + `navHub` (shell) en `src/i18n/messages/{locale}.json`. La page mapea explícitamente los JSON keys a los contracts `InboxLabels` / `NavHubLabels` de cada slice (el JSON sigue el spec, el contract sigue el componente — el mapeo vive en el wiring de la page).
- **Auth guard**: cookie cross-subdomain de Neon Auth (`Domain=.place.community`). La page hace `await getSessionJwt()` (shared helper de S5a); sin token → `redirect("https://place.community/${locale}/login")`. Por lo mismo es `dynamic = "force-dynamic"` (no SSG cacheable). El layout sí prerendera los 4 locales.
- **Co-location**: la zona Hub es DB-bound (lee `app.get_inbox_payload()`). `preferredRegion = "iad1"` para co-locar con Neon (ADR-0006 §Region, `docs/stack.md` §Región).
- **Redirects bidireccionales (S5b)**: `/{locale}/login` y `/{locale}/crear` del apex hacen el mirror — si la cookie de sesión está vigente, redirigen al Hub. Excepción: `/{locale}/crear?from=hub` (CTA "Crear un lugar" del estado vacío del Hub) deja pasar al wizard en modo **authed** (Identidad + Estilo, sin Paso 3 de cuenta — ADR-0008 §3, S5c). La sesión la levanta `createPlaceAction` server-side (`auth.token()`).
- **Logout**: `logoutAction(locale)` borra la cookie cross-subdomain (`signOut()` del SDK) y devuelve `redirectTo` al apex (`https://place.community/${locale}`). El Server Action está bound con `locale` desde la page (`logoutAction.bind(null, locale)`) para satisfacer la firma del prop `onLogout` del Client Component `NavHubLayout`.

## Zona Place — Settings (`{slug}.place.community/settings`)

URL canónica del owner gestionando su lugar: `https://{slug}.place.community/settings/` (y `https://{customdomain}/settings/` cuando el place tiene `place_domain.verified_at`). Owner-only por RLS (no por código separado); cualquier no-owner recibe `notFound()` server-side.

- **Path interno**: `(app)/place/[placeSlug]/settings/page.tsx`. El proxy reescribe `{slug}.place.community/settings` → `/place/{slug}/settings`. Sin `[locale]` en el path (a diferencia de marketing y Hub).

- **i18n DB-based — distinto a marketing/Hub** (ADR-0022). El locale del settings (y de todo el chrome del place en versiones futuras) NO viene del path; es propiedad del place (`place.default_locale`, columna agregada en S2a). La page invoca `getTranslations({locale: place.defaultLocale, namespace: "placeSettings"})` con override explícito del locale resuelto en runtime. Esto es el "modo DB-based" canónico documentado en `docs/architecture.md` § "i18n: dos modos de resolución de locale".

- **`<html lang>` dinámico** (a11y paridad). El layout `(app)/place/[placeSlug]/layout.tsx` setea `<html lang={place.defaultLocale}>` resolviendo el place por slug. Sin esto, `<html lang="es">` con texto en alemán falla axe.

- **Skip-link a11y**: `<a href="#contenido" className="sr-only focus:not-sr-only">{t("skipLink")}</a>` al inicio del shell. Patrón estándar; permite a usuarios de teclado saltar la sidebar.

- **Auth + RLS guard implícito**. La page hace `await getSessionJwt()` → sin token, redirect al login del apex (mismo patrón que Hub). Con token, `await loadPlaceBySlug(executor, placeSlug)` ejecuta bajo el rol `app_system` con claims inyectados → RLS `place_sel` filtra: si el caller no es owner, retorna `null` → `notFound()`. **El settings NO usa el patrón member-read de ADR-0021** — sólo owner. La función `loadPlaceBySlug` reusada en `(app)/place/[placeSlug]/layout.tsx` y en la page; `React.cache` dedupea las dos llamadas a una sola query física por request.

- **Co-location**: como Hub, es DB-bound. `dynamic = "force-dynamic"` + `preferredRegion = "iad1"` (ADR-0006 §Region, `docs/stack.md` §Región).

- **Shell**: `<NavPlaceLayout>` (slice `nav-place`) consume `<AppShell>` agnóstico (ADR-0023, `src/shared/ui/app-shell/`) con sus 6 ítems de sidebar (en V1, solo "Idioma" funcional; los otros 5 con `aria-disabled="true"` + tooltip "Próximamente"). Mismo shell que el Hub — sin divergencia mobile.

- **Logout** desde settings: comparte el flujo del Hub. La cookie cross-subdomain ya cubre `{slug}.place.community` y `app.place.community` por igual. Para places con custom domain (Feature C, ADR-0032), el logout local del settings = borrar la cookie `__Host-place_sso_session` host-only del custom domain. Logout cascade (apex logout invalida sesiones de custom domains) queda V2 — V1 trata cada cookie independientemente. Ver § "Dominios propios".

- **Editar el locale del place** (única sección funcional V1, S7 del plan): el form invoca un Server Action `updateDefaultLocaleAction({placeSlug, newLocale})` que hace `UPDATE place SET default_locale = $1 WHERE slug = $2` bajo el rol `app_system` con claims inyectados. RLS `place_upd` filtra a owner (fail-closed por construcción). Tras OK, `revalidatePath` y la próxima carga del settings renderea en el nuevo idioma. Detalle en `docs/features/settings/spec.md`.

## DNS y Vercel

- Record wildcard: `*.place.community → CNAME → cname.vercel-dns.com`
- En Vercel: configurar wildcard domain en el proyecto
- SSL automático para todos los subdomains

## Dominios propios (custom domains)

Un place puede configurar su propio dominio en vez del subdomain asignado: en vez de `mio.place.community`, servirse en `community.empresa.com`. **El subdomain `{slug}.place.community` sigue existiendo siempre como fallback canónico** (incluso si el custom domain está archived o pending).

- **Routing:** el middleware resuelve el place por hostname. Si el host no es `*.place.community` ni el apex, se busca el place por `place_domain` (ver `data-model.md`); resuelve **solo dominios verificados**; si no matchea, 404.
- **Estado V1.1 (implementado 2026-05-21, ADR-0026 + ADR-0028, ver `docs/features/custom-domain/`):** registro + verificación vía Vercel Domains API en `/settings/domain`. El flow:
  1. Owner escribe su dominio en la UI → `POST /v10/projects/{project}/domains` → Vercel retorna DNS records + challenge.
  2. UI muestra los records al owner → owner los configura en su DNS provider (único paso manual).
  3. **Verificación lazy en page-load** (Server Component invoca `vercel.getDomainStatus(domain)` cada vez que el owner vuelve a `/settings/domain` con `verified_at IS NULL`) + **cron `*/15` opcional como safety net** para owners que cierran el tab y no vuelven (S6 del plan, V1.1 si se justifica en producción).
  4. Vercel es la única fuente de verdad de verificación + SSL; `place_domain.verified_at` espeja ese estado.
- **Lifecycle archived** (ADR-0026): `archived_at` libera el dominio para re-registro (partial unique index `(domain) WHERE archived_at IS NULL`). El subdomain canónico sigue funcionando siempre.
- **Signed Ticket SSO (Feature C, ADR-0032):** la columna `oauth_client_id` queda NULL **indefinidamente** como deuda forward-compat (si V2 vuelve a OIDC canonical, la columna se reutiliza). Signed Ticket NO requiere client OIDC per dominio — el `aud` claim del ticket = host del custom domain, validado contra `place_domain.verified_at IS NOT NULL` directo en `lookupPlaceByDomain`. ADR-0027 (prometida en ADR-0026) **nunca se escribirá** — se supersede por ADR-0032.
- **Host routing real** (`mi-place.com → place`) — Feature B (en planning 2026-05-22, ver `docs/features/custom-domain-routing/` y ADR-0031). El proxy resuelve custom domains contra DB vía función `app.lookup_place_by_domain(host)` `SECURITY DEFINER` (anonymous-safe), retornando `{place_id, slug, default_locale}`. Si matchea fila `verified_at IS NOT NULL` y `archived_at IS NULL` (ambas tablas), rewrite interno a `/place/{slug}{path}` con URL pública intacta. Si no matchea → fallback marketing (nunca servir el place de otro en host ajeno). Defensive validation slug↔host en `(app)/place/[placeSlug]/layout.tsx` con `React.cache()` dedup intra-request.
- **Sesión:** un custom domain no comparte la cookie del apex Neon Auth (`Domain=.place.community`, host-only por dominio). **V1 (Feature B, ADR-0031 §4): gate page educativa server-side** (`<AuthGateForCustomDomain>`, slice `custom-domain-routing`) — fallback CTA cuando el silent SSO falla, copy localizado en `place.default_locale` con link explícito al subdomain canónico. **Feature C (ADR-0032): Signed Ticket SSO** — silent SSO server-side via 3 endpoints (`/api/auth/sso-init` en custom domain → `/api/auth/sso-issue` en apex → `/api/auth/sso-redeem` en custom domain), 4 redirects HTTP sub-segundo, sin spinner ni JS. Owner aterriza en settings con sesión local `__Host-place_sso_session` (JWT ES256 firmado por apex, TTL 7d). Si falla → `<SsoFallbackPanel>` con código de error + retry + canon fallback CTA. Refina ADR-0001 §1 (topología "dos mundos" se mantiene; el SSO interno NO es OIDC canonical sino Signed Ticket — el plugin OIDC Provider de Better Auth no está accesible desde Neon Auth managed, validado 2026-05-22). Cierre operativo: ADR-0032.

**Pages anonymous-allowed bajo custom domain** (root del place `/`, futuras pages públicas): no requieren gate — el placeholder + contenido público del place se sirve idéntico en subdomain canónico y custom domain. Sólo owner-only pages (`/settings/*`) renderean gate page cuando no hay sesión local.

**Pre-existing bug fix incluido en B**: 3 pages bajo `(app)/place/[placeSlug]/` tenían redirects hardcoded a `https://place.community/es/login` (locale `es` literal + apex genérico). Feature B introduce helper `buildOriginalDomainLogin({slug, defaultLocale})` que usa `place.default_locale` + subdomain canónico. Detalle en ADR-0031 §7.

**Forward-compat con cron safety net** (#103, opcional V1.1 deferred): post-B la importancia técnica del cron `*/15` sube — si DNS owner se rompe y owner no vuelve a `/settings/domain`, `verified_at IS NOT NULL` queda stale y visitante ve SSL error de Vercel. Mitigation: documentado en ADR-0031 §Consecuencias; si se observa en producción, activar #103 (cron simple sin back-off; canónico en ADR-0026 §1).

## Development local

Los browsers modernos resuelven `*.localhost` automáticamente. Usar:

- `thecompany.localhost:3000` para probar un place
- `app.localhost:3000` para el inbox
- `localhost:3000` para la landing

Alternativa: entradas en `/etc/hosts` si algún browser no resuelve wildcard localhost.

## RLS: aislamiento por place (base) y modelo rol/JWT

Canónico en **ADR-0006** (esta sección es su spec operativa). El aislamiento entre places se enforcea en el **motor** (Postgres RLS), no solo en código de aplicación.

**Modelo POR-OPERACIÓN (ADR-0010, refinado por ADR-0012).** Las policies se declaran por operación. El INSERT de creación **no** es por-RLS: se canaliza por una función `SECURITY DEFINER` (ADR-0012, hallazgo empírico 2026-05-17 — `WITH CHECK` self-only pura-RLS deja escalación de ownership; ver ADR-0012 §Contexto).

- **`app_user` — `FOR ALL`:** solo la propia fila (USING + WITH CHECK) →
  ```sql
  (select app.current_user_id()) = app_user.auth_user_id
  ```
- **`place` / `place_ownership` / `membership` — INSERT: DENEGADO por RLS.** No hay policy de INSERT para `app_system`; además se `REVOKE INSERT` (defense-in-depth). La creación va **solo** por `app.create_place(...)` (ADR-0012 §3): función `SECURITY DEFINER`, dueño `neondb_owner`, `EXECUTE` solo `app_system`, `SET search_path` fijo; genera el `place_id` (no lo acepta de afuera), toma el caller de `app.current_user_id()` (no parámetro), fija billing/trial deterministas y hace los 3 INSERT atómicos. B no puede crear ownership en place ajeno **por construcción** (la única vía siempre crea un place fresco para el caller).
- **`place_ownership` — SELECT/UPDATE/DELETE:** "esta fila de ownership es mía", **referenciando `app_user`, NUNCA `place_ownership`** (única forma recursion-safe — la auto-referencia da `infinite recursion detected`, verificado 2026-05-17) →
  ```sql
  EXISTS (SELECT 1 FROM app_user au
          WHERE au.id = place_ownership.user_id
            AND au.auth_user_id = (select app.current_user_id()))
  ```
- **`place` / `membership` / `invitation` / `place_domain` — SELECT/UPDATE/DELETE:** solo el **owner** del place →
  ```sql
  EXISTS (
    SELECT 1 FROM place_ownership po
    JOIN app_user au ON au.id = po.user_id
    WHERE po.place_id = <tabla>.place_id   -- para `place`: po.place_id = place.id
      AND au.auth_user_id = (select app.current_user_id())
  )
  ```
  El sub-`SELECT` sobre `place_ownership` aplica su policy no-recursiva (vía `app_user`) → termina.
- **`invitation` — `FOR ALL`: 100% owner-only** (predicado owner; USING + WITH CHECK). El owner crea/lista/revoca por esta base (sin chicken-egg: place+ownership ya existen). Sin policy por email, sin verified-email. La **aceptación** NO pasa por la RLS del usuario: función `SECURITY DEFINER` aparte (ver "RLS e invitaciones").
- **`place_domain` — `FOR ALL`: owner-only** (mismo predicado; USING + WITH CHECK). Entra al conjunto owner-only por ADR-0012 (ADR-0010/esta sección no lo enumeraban — dejarlo sin RLS expondría los custom domains de cualquier place a todo `app_system`).

Owner → CRUD completo solo en su place; la creación va por `app.create_place`; places distintos aislados. **El acceso de miembros NO está en la base** (deliberado): se agrega **por-feature, encima**, según tier/grupo/config. RLS incremental.

Se expresa en Drizzle con `pgPolicy` + `pgRole('app_system').existing()`; las funciones `SECURITY DEFINER` (`app.current_user_id()`, `app.create_place`, aceptación de invitación) se escriben a mano en la migración (Drizzle no las modela; drizzle-kit no las gestiona → sin drift). `app.current_user_id()` lee el claim `sub` inyectado.

**Función de identidad (propia, ADR-0011 — verificada empíricamente 2026-05-17).** Neon RLS NO está provisionado (no existe `auth.user_id()` ni schema `auth`). Definimos la nuestra en la primera migración (S1), versionada y portable dev→prod:

```sql
CREATE SCHEMA IF NOT EXISTS app;
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text
  LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub' $$;
```

Sin claim → `NULL` → la policy deniega. Probado end-to-end con `app_system` (`NOBYPASSRLS`): aislamiento real sin extensión/feature de Neon.

**Modelo rol/JWT (nombres exactos verificados 2026-05-16, agente de verificación; cierran los "TBD acotado" de ADR-0006):**

- **Roles (definidos, ADR-0010):** el **rol de runtime de queries de dominio = `app_system`** (custom, NO-admin, sin `BYPASSRLS`), declarado con `pgRole('app_system').existing()`. Las policies se declaran `to`/`for` `app_system`, NO el `authenticatedRole`/`anonymousRole` de la Data API. `app_system` recibe `GRANT EXECUTE` de las funciones `SECURITY DEFINER` (`app.create_place` — creación; aceptación de invitación) pero **no es su `DEFINER`/dueño**: el dueño es el rol privilegiado de schema/migraciones (`neondb_owner`), de modo que la función inserta/toca las tablas con permiso mientras `app_system` solo la **invoca**. `neondb_owner` (admin, `BYPASSRLS`) **solo** migraciones `drizzle-kit`, nunca en runtime. GRANT de `app_system`: CRUD sujeto a RLS en tablas de producto + `EXECUTE` de funciones privilegiadas + `USAGE` de `public`; sin DDL, sin `BYPASSRLS`, sin `neon_auth`.
- Token: `await auth.token()` (endpoint `/token` del plugin JWT de Neon Auth) → **JWT**. **NO** `auth.getAccessToken()` (token OAuth de proveedor, otro concepto) **NI** el token de `signUp`/`getSession` (sesión OPACA, no JWS → `ERR_JWS_INVALID`). Cierra el TBD de ADR-0006 §Consecuencias — canónico en **ADR-0018**, verificado en prod 2026-05-19. _(La afirmación previa "`getAccessToken()` verificado 2026-05-18" era incorrecta y quedó superada.)_ `auth.token()` lee la sesión del request (cookie); place-first es **two-phase** (signup establece la cookie en una request previa, el create authed la usa). Se verifica con `jose` (`createRemoteJWKSet(new URL(NEON_AUTH_JWKS_URL))` + `jwtVerify`); el claim **`sub`** = `neon_auth.user.id`.
- Se **inyectan los claims** en la transacción: `select set_config('request.jwt.claims', <claims-json>, true)` (**transaction-local, `true` obligatorio** — con el pooler de Neon, omitirlo filtraría identidad entre requests) dentro de `db.transaction`; las policies leen **`app.current_user_id()`** (función propia ADR-0011, ya verificada 2026-05-17 — no depende de Neon RLS/Data API).
- Driver = **`neon-serverless` (WebSocket)** — la saga necesita transacción interactiva (`neon-http` no sirve para tx interactivas).
- **No se usa la Data API ni el rol `anonymous`/`anon`** — sin grants a `anon`, sin acceso no-autenticado a la DB. Todo acceso de dominio es autenticado y verificado server-side.
- Riesgo a vigilar en S1: el SDK cachea la sesión en cookie firmada (~300s, `cookies.sessionDataTtl`); validar que el `exp` del JWT no choque con ese cache.
- Toda op de dominio corre tras `ensureAppUser` (guard JIT idempotente, ADR-0006) y desde `queries.ts`/`actions.ts` del feature.

**RLS e invitaciones (diseño cerrado, ADR-0010 — supersede ADR-0009 §1).** `invitation` es **100% owner-only** en RLS. La invitación se accede y acepta **únicamente por su token-link**; el `invitation.token` (alta entropía, un solo uso) **es** la autorización. **No** hay acceso por email, **no** se requiere email verificado, **no** existe "listar mis invitaciones".

- El owner crea/lista/revoca invitaciones de su place → permitido por la base owner-only.
- Un secreto (token) **no** se expresa como regla RLS de identidad → la validación/aceptación va por una **función de confianza** `SECURITY DEFINER` (`EXECUTE` solo para `app_system`), porque la fila `invitation` es del owner:
  1. **Display (solo-lectura):** valida token (existe / no vencido / no usado). Inválido → error amable, **nada en la DB**.
  2. **Aceptar → form de cuenta → Crear:** en **una tx atómica**: `ensureAppUser` → crea `membership` → invalida la invitación (`accepted_at` NULL→now() con **test-and-set**: `UPDATE … WHERE accepted_at IS NULL RETURNING` — token de un solo uso, resuelve carrera). `UNIQUE(user_id,place_id)` respalda contra doble membership. Re-validar token al mostrar **y** al crear.
- **Email match:** el email de la cuenta creada DEBE ser `invitation.email` (estricto, ADR-0008) — prefijado/bloqueado en el form (detalle de la UI de aceptación, diferida).
- **Host del link:** `{slug}.place.community/invite/{token}`; si el place tiene custom domain verificado (`place_domain.verified_at IS NOT NULL`), `https://{dominio}/invite/{token}`.
- La tabla `invitation` nunca queda expuesta a scan por usuarios; el invitado nunca hace `SELECT`/`UPDATE` directo sobre `invitation` bajo su rol.
- **"Unirme" (vía Acceso, ADR-0008/0010):** ya **no** lista invitaciones por email (eliminado). Tras el signup account-first: "Crear mi place" (funcional) y "Unirme" = solo **directorio** (no existe) → **deshabilitado/"próximamente"**. Las invitaciones se entran por el link del email, no desde el menú "Acceso".

## Slug inmutable

El slug del place es inmutable una vez creado. Si un usuario necesita cambiar el slug de su place, es operación manual por soporte. Razón: los URLs compartidos, los invites enviados, y las referencias externas rompen si el slug cambia.

## Reservados

Subdomains que no pueden ser usados como slug de place:

- `app`, `www`, `api`, `admin`
- `staging`, `dev`, `test`
- Cualquier otro que el producto use para funcionalidad propia

Esta lista vive en código como constante en `shared/config/reserved-slugs.ts` y se valida en el flow de creación.
