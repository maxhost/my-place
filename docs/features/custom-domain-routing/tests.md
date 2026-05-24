# Custom Domain Host Routing V1 — TDD Checklist

> Checklist por capa. Cada test describe una expectativa observable; el orden refleja el plan de sesiones (`docs/features/custom-domain-routing/plan-sesiones.md` será generado en S6 close-out). Convención: `[ ]` pending, `[x]` ejecutado verde.

## Mandato TDD (CLAUDE.md §"Durante la implementación")

**Tests primero, verificar que fallan, implementar, verificar que pasan. Sin excepciones en core.**

El core de Feature B son 5 piezas con cobertura directa: (1) función Postgres `app.lookup_place_by_domain` (SQL), (2) wrapper anonymous-safe `custom-domain-lookup.ts`, (3) extensión async de `host-routing.ts` (`resolveHostWithCustomDomains`), (4) proxy ramificado, (5) layout defensive validation. El gate page (Server Component del slice nuevo `custom-domain-routing`) y el helper `auth-redirect.ts` cubren la UX V1 del cookie cross-domain gap (ADR-0031 §4 / §7).

## Canon "Server Actions sin tests directos"

Heredado del precedente `docs/features/custom-domain/tests.md` y del canon `update-default-locale.ts:13`. En Feature B **no hay Server Actions nuevas** — los Server Components (layout, gate page) se tipan + buildean + smoke. La cobertura vitest se concentra en piezas puras + integration con mocks (proxy, lookup wrapper).

---

## S1 — Migration 0009 `app.lookup_place_by_domain` SECURITY DEFINER

### `src/db/__tests__/lookup-place-by-domain.test.ts` (nuevo)

**Por qué importa:** la función `SECURITY DEFINER` es el único acceso a `place_domain` desde un caller anónimo (proxy edge sin claim). Si filtra mal, sirve places ajenos en hosts equivocados (data leakage cross-tenant). Si el patrón DEFINER se debilita o se concede EXECUTE a PUBLIC, RLS owner-only de `place_domain` (ADR-0012) queda desbordada.

**Harness:** `inRlsTx` (`src/db/__tests__/db-test-pool.ts`) — seed-as-owner, assert-as-`app_system` con claim vacío. ROLLBACK siempre, cero footprint en el branch `test`.

**Casos cubiertos** (≥9):

**Happy path:**
- [ ] Returns jsonb `{place_id, slug, default_locale}` cuando el host matchea fila `verified_at IS NOT NULL`, `archived_at IS NULL` sobre place `archived_at IS NULL`.

**Filtros del predicado:**
- [ ] Returns `NULL` cuando `pd.verified_at IS NULL` (pending NO rutea — el partial unique permite la fila pero el lookup la oculta).
- [ ] Returns `NULL` cuando `pd.archived_at IS NOT NULL` (archived libera el dominio; el lookup NO debe servirlo).
- [ ] Returns `NULL` cuando `p.archived_at IS NOT NULL` (place tombstoneado, ADR-0003).
- [ ] Returns `NULL` cuando el host no existe en `place_domain` (zero rows).

**Case-insensitivity (DNS canon):**
- [ ] `NoCodeCompany.CO` matchea fila registrada como `nocodecompany.co` (predicado `lower(pd.domain) = lower(p_host)`).

**Patrón DEFINER (clave de seguridad):**
- [ ] Caller `app_system` SIN claim (`request.jwt.claims` = `""`) recibe el jsonb correctamente — el DEFINER bypasea RLS owner-only de la tabla.
- [ ] Regression: SELECT directo sobre `place_domain` desde `app_system` con claim vacío (sin DEFINER fn) retorna 0 rows — RLS owner-only de ADR-0012 sigue activa. El DEFINER **NO** debilita la base, sólo crea un canal específico.

**Defensa-en-profundidad:**
- [ ] `LIMIT 1`: si por bug del partial unique existen 2 filas activas con mismo `domain`, la función retorna 1 sola (no array). El invariante del partial unique se respeta, pero `LIMIT 1` es safety net documentado en ADR-0031 §1.

**Validation manual** (no en CI — confirmar tras aplicar migration en local + preview):

- [ ] `psql ... -c "SELECT proname, prosecdef FROM pg_proc WHERE proname='lookup_place_by_domain';"` retorna `prosecdef = t`.
- [ ] `psql ... -c "\df app.lookup_place_by_domain"` muestra `Security` = `definer`.
- [ ] `psql ... -c "\dp app.lookup_place_by_domain"` muestra EXECUTE concedido **sólo** a `app_system` (NO a PUBLIC).
- [ ] `REVOKE EXECUTE ... FROM PUBLIC` aplicado (no aparece `=X/owner` para PUBLIC en `\dp`).
- [ ] Header de la migration documenta reverse-SQL (`DROP FUNCTION app.lookup_place_by_domain(text);`); smoke manual: aplicar → revertir → re-aplicar — sin error.
- [ ] `search_path = public, pg_temp` seteado en la función (`pg_proc.proconfig`).

**Total S1: ≥9 tests vitest + ≥6 verificaciones manuales (psql).**

---

## S2 — Wrapper `custom-domain-lookup.ts` + `HostZone` async

### `src/shared/lib/__tests__/custom-domain-lookup.test.ts` (nuevo)

**Por qué importa:** el wrapper es el seam entre Postgres (snake_case + jsonb) y el contrato TS del slice (camelCase + discriminated union). Si normaliza mal el host o no es fail-safe ante errores, el proxy crashea en el hot path del visitante.

**Mocks usados:**
- Pool `@neondatabase/serverless` mockeado vía `vi.mock("@/db/client", ...)` o inyección por seam — el wrapper acepta `pool` por dependency injection (mismo patrón de los Vercel wrappers de Feature A).
- `vi.fn()` para el query method; `vi.spyOn(console, "error")` para asertar log estructurado.

**Casos cubiertos** (≥7):

**Normalización del host:**
- [ ] Host válido lowercase (`nocodecompany.co`) → query ejecutado con arg exacto → retorna `{placeId, slug, defaultLocale}` (camelCase). El wrapper traduce snake_case del jsonb a camelCase del contrato.
- [ ] Host con uppercase (`Nocodecompany.CO`) → wrapper lowercaseа antes del query (assert arg del mock).
- [ ] Host con `:port` (`nocodecompany.co:3000`) → strip del port antes del query (assert arg). Defensa-en-profundidad: el caller del proxy ya debería pasar host limpio, pero el wrapper protege.
- [ ] Host con trailing dot DNS-canónico (`nocodecompany.co.`) → strip antes del query.

**Resolución del resultado:**
- [ ] Query retorna `NULL` (jsonb null escalar) → wrapper retorna `null`.
- [ ] Query retorna jsonb shape correcto → wrapper retorna objeto camelCase.

**Fail-safe (ADR-0031 §2 "marketing fallback on lookup-null"):**
- [ ] Pool mock que `throws` (DB error simulado) → wrapper retorna `null` + log estructurado vía `console.error` (assert con `vi.spyOn`).
- [ ] Connection timeout simulado (mock que rechaza con `Error("ETIMEDOUT")`) → idem (`null` + log).

**`React.cache()` dedup:**
- [ ] El wrapper exportado está envuelto en `React.cache(...)` (assert que dos invocaciones con el mismo arg en el mismo request → 1 sola llamada al pool — `vi.fn().mock.calls.length === 1`).

### `src/shared/lib/__tests__/host-routing.test.ts` (extender)

**Por qué importa:** el archivo existente tiene tests de `resolveHost` SYNC que NO se tocan (ADR-0031 §"Alternativas rechazadas" A5). Se agrega `describe("resolveHostWithCustomDomains")` con 9 casos que cubren la lógica heurística de "candidato a custom domain" + branching.

**Mocks usados:**
- `lookup` injectado como argumento del wrapper (`lookup: (host: string) => Promise<...>`). En los tests se pasa `vi.fn()` con shape controlado.

**Casos cubiertos** (≥10):

**Hosts conocidos — NO consulta lookup (assert `lookup.mock.calls.length === 0`):**
- [ ] Apex (`place.community`) → marketing.
- [ ] `www.place.community` → marketing.
- [ ] `app.place.community` → inbox.
- [ ] `slug.place.community` → `{zone: "place", slug: "slug"}`.
- [ ] `localhost` → marketing.
- [ ] `mi-slug.localhost` → `{zone: "place", slug: "mi-slug"}`.
- [ ] `xxx.vercel.app` (preview) → marketing (sin lookup).

**Custom domain branching:**
- [ ] Host random unknown (`nocodecompany.co`) + lookup mockeado returns `{placeId, slug, defaultLocale}` → retorna `{zone: "custom-domain", placeId, slug, defaultLocale}`.
- [ ] Host random unknown + lookup retorna `null` → retorna `{zone: "marketing"}` (fail-safe).
- [ ] Host random unknown + lookup `throws` (rechaza promise) → retorna `{zone: "marketing"}` (fail-safe; el visitante ve landing, no 500).

**Typecheck exhaustivo:**
- [ ] Compile-time: el discriminated union de 4 variantes (`marketing | inbox | place | custom-domain`) fuerza `switch` exhaustivo en el caller. Test: un `switch(zone)` sin `default` que omita una variante NO debe typecheckar (verificable con `// @ts-expect-error` en un test fixture).

**Total S2: ≥9 wrapper + ≥10 host-routing async = ≥19 tests nuevos.**

---

## S3 — Proxy async + defensive validation layout

### `src/__tests__/proxy.test.ts` (nuevo)

**Por qué importa:** el proxy es el primer hop del request. Bug = visitantes en custom domain ven la landing en vez del place, o peor, place ajeno por mismatch host↔slug.

**Mocks usados:**
- `NextRequest` construido manualmente con `host` header + `nextUrl` (`pathname`, `searchParams`).
- `vi.mock("@/shared/lib/custom-domain-lookup", ...)` con `lookupPlaceByDomain` mockeado por test.
- `vi.mock("next-intl/middleware", ...)` retornando un intlMiddleware identity (proxy pass-through) — el i18n no es objeto del test del proxy en sí.

**Casos cubiertos** (≥9):

**Branches conocidos (regresión — no rompe el comportamiento sync):**
- [ ] Apex request → marketing branch → `intlMiddleware(req)` invocado.
- [ ] `app.place.community` request → inbox branch → compose intl + rewrite a `/inbox/...`.
- [ ] `slug.place.community` request a `/foo` → rewrite a `/place/slug/foo` (no toca intl).

**Custom domain branch (nuevo):**
- [ ] `nocodecompany.co` con lookup mock que retorna `{slug: "mi-place", ...}` y pathname `/` → rewrite a `/place/mi-place` (sin trailing slash; preserva el path `/` colapsándolo).
- [ ] Pathname `/settings` → rewrite a `/place/mi-place/settings` (URL pública `nocodecompany.co/settings` intacta en el browser; el rewrite es interno).
- [ ] Query string preservado: `/foo?a=1&b=2` → rewrite a `/place/mi-place/foo?a=1&b=2`.
- [ ] Trailing slash preservado: `/settings/` → rewrite a `/place/mi-place/settings/`.
- [ ] Host con uppercase (`NoCodeCompany.CO`) → wrapper normaliza, lookup matchea, rewrite correcto.
- [ ] Host random unknown + lookup mock `null` → fallback marketing (`intlMiddleware(req)` invocado, NO rewrite).

**Cookies y headers (defensa-en-profundidad):**
- [ ] Custom domain rewrite NO setea cookies nuevas (a diferencia del inbox branch que propaga `NEXT_LOCALE`).
- [ ] Custom domain rewrite preserva cookies inbound del request (no las strip).

### `src/app/(app)/place/[placeSlug]/__tests__/layout.test.tsx` (nuevo o extender si existe)

**Por qué importa:** la defensa-en-profundidad slug↔host es la última línea contra rewrite manipulation o bug interno (ADR-0031 §5). Sin ella, un bug del proxy expone el place de un owner en el dominio de otro.

**Mocks usados:**
- `vi.mock("next/headers", ...)` con `headers().get("host")` controlado por test.
- `vi.mock("@/shared/lib/custom-domain-lookup", ...)` con `vi.fn()` que cuenta invocaciones.
- `vi.mock("next/navigation", ...)` con `notFound()` mock observable.

**Casos cubiertos** (≥6):

**Hosts trusted — NO consulta lookup (assert `lookup.mock.calls.length === 0`):**
- [ ] Host `mi-slug.place.community` (subdomain canónico) → layout renderea normal, NO consulta lookup.
- [ ] Host `place.community` apex → idem (esto NO debería pasar normalmente — apex no rutea a `/place/[placeSlug]/` — pero la defensa permite el bypass para no romper edge cases).
- [ ] Host `localhost` / `mi-slug.localhost` → NO consulta lookup, layout renderea.
- [ ] Host `xxx.vercel.app` → NO consulta lookup, layout renderea.

**Custom domain branch — defensive validation activa:**
- [ ] Custom domain (`nocodecompany.co`) + lookup retorna `{slug: "mi-place"}` que matchea `placeSlug` del param → layout renderea normal (acceso legítimo via proxy).
- [ ] Custom domain + lookup retorna `null` (host unknown que llegó al layout por bug/manipulación) → `notFound()` invocado.
- [ ] Custom domain + lookup retorna `{slug: "otro-place"}` que NO matchea `placeSlug` del param → `notFound()` invocado (defensa cross-tenant).

**`React.cache()` dedup intra-request:**
- [ ] El proxy y el layout invocan `lookupPlaceByDomain(host)` con el mismo arg en el mismo request → 1 sola query física (asertar `lookup.mock.calls.length === 1` tras componer las dos llamadas mockeadas vía la integración cache). El test concreto puede simular esto vía render directo del Server Component + spy del wrapper.

**Total S3: ≥9 proxy + ≥7 layout = ≥16 tests nuevos.**

---

## S5 — i18n keys × 6 locales

### Validación: `node scripts/check-translations.mjs`

**Por qué importa:** ADR-0024 + ADR-0022 establecen paridad estricta entre los 6 locales. Una key faltante en uno rompe el render del gate page en ese locale.

**Casos cubiertos** (≥4):

- [ ] Los 6 archivos JSON (`src/i18n/messages/{es,en,fr,pt,de,ca}.json`) tienen namespace `customDomainRouting.authGate` con 4 keys: `title`, `body`, `cta`, `help`.
- [ ] `node scripts/check-translations.mjs` exit code 0 + 0 warnings + 0 errors post-S5.
- [ ] Placeholders `{slug}` están en raw en los templates (NO ICU complex syntax). Referencia: memoria `next-intl-icu-template-raw` + ADR-0024. Grep negativo: `grep -nE "\{slug,[^}]+\}" src/i18n/messages/*.json` debe retornar 0 matches.
- [ ] Paridad estricta cross-locale: el set de keys en `es.json` bajo `customDomainRouting.authGate` es **idéntico** al set en `en|fr|pt|de|ca.json` (sin huérfanas, sin faltantes — el script lo verifica).

**Total S5: ≥4 verificaciones automatizadas (script-driven, no vitest directo).**

---

## S4 — Auth-redirect helper + gate page + fix bugs pre-existentes

### `src/shared/lib/__tests__/auth-redirect.test.ts` (nuevo)

**Por qué importa:** el helper centraliza la construcción de URLs de login al subdomain canónico desde owner-only pages. Bug = locale hardcoded `es` se cuela en redirects de places en otro idioma (bug pre-existente que B fixea, ADR-0031 §7).

**Casos cubiertos** (≥6):

**`buildOriginalDomainLogin({slug, defaultLocale})`:**
- [ ] `{slug: "mi-place", defaultLocale: "es"}` → `https://mi-place.place.community/es/login`.
- [ ] `{slug: "mi-place", defaultLocale: "de"}` → `https://mi-place.place.community/de/login` (fixea el bug `es` hardcoded).
- [ ] Slug con guiones (`mi-club-fc`) → preservado en el subdomain sin URL-encoding extra (slug ya es safe per slugSchema).
- [ ] Locale fuera del set conocido (`xx`) → fallback al default del repo. <!-- TODO: verificar con ADR-0031 — la ADR no explicita el fallback exacto del helper si el locale es inválido; puede defaultear a `es` por compat con el bug pre-existente, o al primer locale del `routing.locales`. -->

**`buildApexAuthFallback({slug, locale, path})` (gate page CTA target):**
- [ ] `{slug: "mi-place", locale: "es", path: "/settings"}` → `https://mi-place.place.community/es/settings`.
- [ ] Path con query string preservado (`/settings?tab=domain`) → `https://mi-place.place.community/es/settings?tab=domain`.

### `src/shared/lib/__tests__/is-custom-domain-host.test.ts` (nuevo o dentro de `auth-redirect.test.ts`)

**Por qué importa:** la heurística pura distingue "estoy bajo custom domain" sin re-consultar DB. Bug = gate page renderea sobre subdomain canónico (falso positivo) o NO renderea sobre custom domain (falso negativo).

<!-- TODO: verificar con ADR-0031 — la ADR §4 menciona `isCustomDomainHost(host, slug, rootHost)` como heurística pura, pero no fija el path exacto del archivo. Lo más coherente con el slice nuevo es `src/shared/lib/host-routing.ts` (extensión) o `src/features/custom-domain-routing/lib/`. -->

**Casos cubiertos** (≥5):

- [ ] `slug.place.community`, `slug`, `place.community` → false (subdomain canónico).
- [ ] `mi-slug.localhost`, `mi-slug`, `place.community` → false (dev local).
- [ ] `place.community`, `mi-place`, `place.community` → false (apex).
- [ ] `nocodecompany.co`, `mi-place`, `place.community` → true (custom domain real).
- [ ] `NoCodeCompany.CO`, `mi-place`, `place.community` → true (case-insensitive, normaliza antes de comparar).

### `src/features/custom-domain-routing/__tests__/auth-gate.test.tsx` (nuevo)

**Por qué importa:** el gate page es el cierre UX V1 del cookie cross-domain gap (ADR-0031 §4). Bug = auto-redirect en vez de link visible (rompe agency del owner) o copy en locale incorrecto.

**Mocks usados:**
- `vi.mock("next-intl/server", ...)` con `getTranslations({locale, namespace})` que retorna un mock `t(key, vars)` con templates raw (`{slug}` resuelto).
- RTL `render(...)` sobre el Server Component (acepta props directos: `slug`, `defaultLocale`, `returnPath`).

**Casos cubiertos** (≥5):

- [ ] Renderea 4 elementos identificables: title heading, body con `{slug}` resuelto al prop, CTA link (`<a>` con `href`), help text. Assert presencia de cada uno vía `getByRole` / `getByText`.
- [ ] El locale del `getTranslations` call es exactamente el `defaultLocale` prop (no Accept-Language, no path locale, no negotiation — espeja ADR-0022).
- [ ] CTA es elemento `<a href="...">`, NO `<button>`, NO `redirect()` server-side (ADR-0031 §4 "link visible no auto-redirect"). Assert con `getByRole("link")`.
- [ ] CTA `href` exacto = `buildApexAuthFallback({slug, locale: defaultLocale, path: returnPath})`. Test con props controlados → assert string exacto del `href`.
- [ ] Sin `useEffect`, sin `<script>` auto-redirect, sin `<meta http-equiv="refresh">`. Grep negativo en el render output (`container.innerHTML` no contiene patterns de redirect).

### Pre-existing bugs fixed in S4

**Por qué importa:** la cohesión del commit S4 — el mismo cambio que introduce el gate borra los 3 redirects con `es` hardcoded + apex literal. ADR-0031 §7 lo registra.

**Verificación grep-driven** (no vitest; smoke estructural antes del commit S4):

- [ ] `src/app/(app)/place/[placeSlug]/settings/page.tsx` NO contiene literal `redirect("https://place.community/es/login")` (grep negativo).
- [ ] `src/app/(app)/place/[placeSlug]/settings/domain/page.tsx` NO contiene literal `redirect("https://place.community/es/login")`.
- [ ] `src/app/(app)/place/[placeSlug]/not-found.tsx` NO contiene `href="https://place.community"` literal apex.
- [ ] Los 3 pages importan y usan `buildOriginalDomainLogin(...)` con `place.default_locale` (grep positivo del símbolo importado).

**Total S4: ≥6 auth-redirect + ≥5 isCustomDomainHost + ≥5 gate page + 4 grep negativos = ≥20 tests / verificaciones.**

---

## S6 — Smoke E2E + regression

### Automated (`pnpm test` + `pnpm build` + `pnpm lint` + `pnpm typecheck`)

- [ ] Full suite vitest verde post-S5 (todos los tests anteriores + suite existente del repo). Sin tests rojos, sin tests skipped nuevos.
- [ ] `pnpm typecheck` clean — sin warnings nuevos. El discriminated union `HostZone` con 4 variantes fuerza handle exhaustivo en proxy + layout.
- [ ] `pnpm build` exitoso. Next 16 valida el proxy `async` boundary; build red flag = el wrapper rompe el grafo de tipos.
- [ ] `pnpm lint` clean — sin warnings nuevos del slice `custom-domain-routing`.
- [ ] `node scripts/check-translations.mjs` exit 0 (cubierto en S5, re-verificar en S6 como gating).
- [ ] Cap LOC del slice `custom-domain-routing` ≤ 1500 (CLAUDE.md §"Límites de tamaño"; proyección ADR-0031 ~200 LOC).
- [ ] Cap función ≤ 60 LOC, archivo ≤ 300 LOC en cada archivo nuevo (`custom-domain-lookup.ts`, `auth-redirect.ts`, `auth-gate.tsx`, `public.ts`).

### Manual smoke local (con `/etc/hosts` + DB local + `pnpm dev`)

**Setup:** `/etc/hosts` línea `127.0.0.1 community.empresa.local`; en DB local, fila en `place_domain` con `domain = "community.empresa.local"`, `verified_at = now()`, `place_id` apuntando a un place con `slug = "empresa"` + `default_locale = "es"`.

- [ ] `pnpm dev` levanta sin errores en stdout.
- [ ] `community.empresa.local:3000/` (visitante anónimo) → placeholder del place servido con URL intacta en el browser. HTML response tiene `<html lang="es">` (o el `defaultLocale` del place).
- [ ] `community.empresa.local:3000/settings` (anónimo) → renderea gate page localizado con title + body con `{slug}` resuelto a `empresa` + CTA link + help.
- [ ] Click del CTA → navegación a `empresa.localhost:3000/es/settings` (subdomain canónico, locale del place).
- [ ] `empresa.localhost:3000/settings` con sesión local → renderea `<DomainSection>` normal (no regresión del slice `custom-domain`).
- [ ] `place.community` (root local; via `/etc/hosts` apuntando a 127.0.0.1) → marketing landing renderea normalmente (no regresión).
- [ ] `random-unknown-host.local:3000/` (no en `place_domain`) → fallback marketing landing. Logs muestran 1 query del wrapper que retornó `null`.
- [ ] `community.empresa.local:3000/place/otro-slug/settings` (manipulación interna del path) → `notFound()` renderea 404 del repo (no sirve el place ajeno).
- [ ] `community.empresa.local:3000/settings?tab=foo` → gate page; click del CTA → `empresa.localhost:3000/es/settings?tab=foo` (query preservado).

### Manual smoke production (post-push autorizado, ADR-0031 §"Inmediatas")

**Pre-requisito:** push autorizado por el user explícitamente (memoria `feedback_no_push_until_authorized.md`).

- [ ] MCP Vercel: deploy `dpl_*` status `READY` post-push.
- [ ] MCP Neon: `SELECT verified_at, archived_at FROM place_domain WHERE domain = 'nocodecompany.co'` → `verified_at IS NOT NULL`, `archived_at IS NULL` (intacto, no se altera por el deploy).
- [ ] `https://nocodecompany.co/` → placeholder del place renderea con URL intacta en el browser. Sin redirect, sin error SSL.
- [ ] `https://nocodecompany.co/settings` (anónimo desde browser fresco) → gate page localizado con copy en `place.default_locale`.
- [ ] Click del CTA del gate → llega a `https://mi-place.place.community/{defaultLocale}/settings`. Si el owner ya tiene sesión apex → settings renderea; si no → login normal del apex.
- [ ] `https://mi-place.place.community/settings` con sesión → `<DomainSection>` renderea normalmente (no regresión del feature A).
- [ ] `https://place.community/` → marketing landing (no regresión).
- [ ] MCP Vercel logs runtime: 0 errors del slice `custom-domain-routing` en los primeros 10min post-deploy.

**Total S6: ≥6 automated gating + ≥9 manual local + ≥8 manual production.**

---

## Lo que NO probamos (decisión)

- **RLS owner-only de `place_domain`** — ya cubierto en `src/db/__tests__/rls.test.ts` desde ADR-0012; S1 sólo verifica que el DEFINER NO debilita la base (regression test).
- **Driver Neon (ws vs http)** — la decisión §3 de ADR-0031 fija ws con gating step manual. Si Vercel fuerza Edge en futuro, swap del driver es 1 file (~15 LOC) + no requiere nueva ADR.
- **Cache V2 in-memory** — V1 no la implementa (ADR-0031 §6). Criterio cuantitativo de activación (p95 > 100ms / req rate > 100/min sostenido / owner report) es operativo, no testeable en vitest.
- **Cron safety net (#103)** — diferido a post-B (ADR-0031 §"Forward-compat"). Si en producción aparece un caso de `verified_at` stale + SSL error, S6 V1.1 activa el cron y agrega sus propios tests.
- **SSO desde custom domain (Feature C)** — fuera de scope de este test suite (Feature B). Cubierto por suite de [`docs/features/custom-domain-sso/tests.md`](../custom-domain-sso/tests.md). Pattern real: **Signed Ticket** (ADR-0032), no OIDC. Silent SSO via server-side redirect chain `init→issue→redeem` (no `prompt=none`). El gate page V1 (Feature B) queda como CTA fallback dentro de `<SsoFallbackPanel>` (componente Feature C-S6 montado en este slice).
- **Server Components (layout, gate page) con vitest directo más allá de los tests acá listados** — canon `update-default-locale.ts:13`. La validación profunda es typecheck + build + smoke vivo (S6).
- **Performance del proxy** — no se mide en vitest. Latencia esperable Neon iad1: 5-20ms/query; aceptable per ADR-0031 §6.
- **Webhook Vercel domain status** — Vercel no expone events de domain status (ADR-0031 §Alternativas A4); lazy poll + lookup directo cubre.

---

## Coverage acumulado

V1 de Feature B esperado (sin S6 manual):

- ≥9 tests para `app.lookup_place_by_domain` (S1 — SQL DEFINER + filtros + DEFINER pattern + LIMIT 1).
- ≥6 verificaciones manuales psql del DEFINER pattern + GRANT/REVOKE + reverse-SQL (S1, no vitest).
- ≥9 tests para `custom-domain-lookup` wrapper (S2 — normalización + fail-safe + React.cache).
- ≥10 tests para `resolveHostWithCustomDomains` async (S2 — branches conocidos + custom-domain + fail-safe + typecheck exhaustivo).
- ≥9 tests integration para proxy async (S3 — branches existentes + custom-domain + query/path preserve + uppercase host).
- ≥7 tests para layout defensive validation (S3 — trusted hosts + custom domain match/mismatch/null + React.cache dedup).
- ≥4 verificaciones para i18n keys × 6 locales (S5 — script-driven).
- ≥6 tests para `auth-redirect` helper (S4 — `buildOriginalDomainLogin` + `buildApexAuthFallback` + locale fix).
- ≥5 tests para `isCustomDomainHost` heurística pura (S4).
- ≥5 tests para gate page Server Component (S4 — render + locale + `<a>` no auto-redirect + href exacto).
- ≥4 grep negativos de bugs pre-existentes fixeados (S4 — los 3 redirects literales + helper importado).

**Total esperado al cierre de S5: ≥64 tests vitest nuevos + ≥10 verificaciones script/grep/psql.**

S6 smoke (≥6 automated + ≥9 manual local + ≥8 manual production) es gating del push autorizado, no se contabiliza como tests vitest.

---

## Pointers

- **Plan canónico:** `docs/decisions/0031-custom-domain-routing-v1.md`.
- **Spec del feature:** `docs/features/custom-domain-routing/spec.md`.
- **Precedente directo (Feature A):** `docs/features/custom-domain/tests.md`.
- **Harness RLS:** `src/db/__tests__/db-test-pool.ts` (`inRlsTx` — seed-as-owner, assert-as-`app_system`, ROLLBACK siempre).
- **`resolveHost` SYNC (referencia para extensión async):** `src/shared/lib/host-routing.ts`.
- **Proxy actual (firma sync que pasa a async en S3):** `src/proxy.ts`.
- **i18n parity script:** `scripts/check-translations.mjs`.
- **Canon "Server Actions sin tests directos":** `src/features/place-settings/actions/update-default-locale.ts:13`.
- **`React.cache()` precedente:** `src/app/(app)/place/[placeSlug]/_lib/get-place-for-zone.ts`.
- **Multi-tenancy update post-B:** `docs/multi-tenancy.md` §"Dominios propios".
- **ADRs relacionadas:** ADR-0026 (Feature A V1), ADR-0028 (slice promotion), ADR-0029 (verified false-positive fix), ADR-0030 (split por capa), ADR-0022 (i18n DB-based), ADR-0012 (RLS owner-only).
