# Testing

Estrategia de tests de Place y cómo correr cada capa. Doc canónico: la config de
Playwright, `next.config.ts` y `.env.e2e.example` apuntan acá para el rationale.

> **Última actualización:** 2026-06-01 (Phase 2.B.1 tech-debt — E2E register custom domain + stub de Vercel + helper de bootstrap).

## Capas

| Capa            | Runner       | Qué cubre                                                              | Dónde |
| --------------- | ------------ | --------------------------------------------------------------------- | ----- |
| **Unit**        | Vitest (`ui` + `node` projects) | Lógica pura, componentes (jsdom), dominio de slices       | `src/**/__tests__/*.test.ts(x)` |
| **Integration** | Vitest (`node` project)         | DB real contra branch `test` de Neon, RLS por-operación   | `src/db/__tests__/*.test.ts` |
| **E2E**         | Playwright   | Flujos críticos end-to-end (browser → app local → DB branch test)     | `tests/e2e/*.spec.ts` |

Las dos primeras capas (Vitest) están documentadas operativamente en el header
de `.github/workflows/tests.yml` y en `src/db/__tests__/db-test-pool.ts`. Este
doc se concentra en **E2E**, que es lo nuevo (Phase 2.A).

---

## E2E con Playwright

### Modelo mental

Los E2E levantan la **app local** (`pnpm dev` sobre HTTPS) y la manejan con un
browser real (Chromium + WebKit). La app apunta al branch **`test`** de Neon — el
MISMO branch que usan los tests de integración Vitest — para no tocar nunca data
de producción ni del branch de desarrollo.

```
Playwright (browser) → https://lvh.me:3000 (next dev --experimental-https) → branch `test` de Neon
```

### Por qué `lvh.me` como apex

`lvh.me` es un dominio público que resuelve a `127.0.0.1` **incluyendo todos sus
subdominios** (`*.lvh.me`). Eso permite ejercitar el routing multi-tenant por
subdominio (apex vs `{slug}.lvh.me`) sin tocar `/etc/hosts`. Además es *dotted*,
así que pasa el regex `APEX_DOMAIN` de `src/shared/lib/auth-config.ts` (a
diferencia de `localhost`, que no tiene punto y rompería la lógica de zona).

### Por qué `allowedDevOrigins` en `next.config.ts`

Next 16 en modo dev bloquea HMR y dev assets para orígenes ≠ `localhost` salvo
que estén listados en `allowedDevOrigins`. Sin `["lvh.me", "*.lvh.me"]` la
hidratación no completa sobre `lvh.me` y el wizard nunca se vuelve interactivo.
Ese setting **sólo afecta `next dev`** — es ignorado en el build de producción.

### Por qué HTTPS (y cert self-signed)

Neon Auth (Better Auth) **rechaza orígenes `http://` no-localhost** en sus
`trusted_origins`: sólo acepta `https://` (cualquier host) o `http://localhost`.
Como el apex de los E2E es `lvh.me` (no localhost, requerido por el regex de
apex + el cookie-domain multi-tenant), el signup falla con `403 "Invalid origin"`
sobre http. Por eso el dev server corre sobre **HTTPS**:

- `pnpm e2e` ejecuta `scripts/ensure-e2e-cert.mjs` antes de Playwright: genera
  (idempotente) un cert self-signed para `lvh.me` con **openssl** — sin mkcert ni
  sudo (el `--experimental-https` pelado de Next pide `mkcert -install`, que es
  interactivo y genera el cert para `localhost`, no `lvh.me`).
- El cert vive en `certificates/` (**gitignored** — cada dev/CI lo regenera).
- `playwright.config.ts` arranca `next dev --experimental-https
  --experimental-https-key/-cert …` y corre con `ignoreHTTPSErrors: true` (el
  cert no está en el trust store del sistema).
- El origin `https://lvh.me:3000` está agregado a `trusted_origins` del Neon Auth
  del branch `test` (config per-branch; se setea con el MCP `configure_neon_auth`
  op `add_trusted_origin`, o en Neon Console → Auth). **Sólo el branch test** —
  prod tiene su propia config.

### Setup local (one-time)

1. Copiá el template: `cp .env.e2e.example .env.e2e` (gitignored).
2. Completá las creds del branch `test` siguiendo los comentarios del template:
   - `DATABASE_URL` / `DATABASE_URL_MIGRATE` → mismos valores que
     `DATABASE_URL_TEST` / `DATABASE_URL_TEST_MIGRATE` de tu `.env.local`.
   - `NEON_AUTH_BASE_URL` / `NEON_AUTH_JWKS_URL` → **per-branch**: el endpoint de
     Neon Auth del branch `test` difiere del de dev (Neon Console o MCP
     `get_neon_auth_config`).
   - `NEON_AUTH_COOKIE_SECRET` → reusá el de `.env.local` (≥32 chars).
3. `pnpm e2e` (Playwright instala los browsers la primera vez si faltan:
   `pnpm exec playwright install`).

> **Split-brain:** `playwright.config.ts` carga `.env.e2e` con dotenv y se lo
> inyecta explícito al `webServer.env`. Next no pisa vars ya presentes en el
> entorno con `.env.local` → los valores del branch `test` ganan. Sin esto la
> app hablaría con el branch dev.

### Convención de datos de test + cleanup

**Todo spec que cree una cuenta DEBE usar un email con prefijo `e2e-` y dominio
`@example.com`** (p. ej. `e2e-${Date.now()}@example.com`). Ese patrón
(`E2E_EMAIL_PATTERN` en `tests/e2e/_support/db-cleanup.ts`) es lo que el barrido
de cleanup matchea.

El cleanup corre en dos momentos (ambos en `tests/e2e/_support/`):

- **`global-setup.ts`** — pre-clean defensivo: barre huérfanos de un run que
  crasheó antes de su teardown, para arrancar de estado conocido.
- **`global-teardown.ts`** — post-run: borra TODA la data sembrada por la suite.

El barrido (`cleanupE2EData`) conecta con el rol **admin** (`neondb_owner`,
BYPASSRLS, dueño de las tablas) vía `DATABASE_URL_MIGRATE` y borra en orden
FK-safe (`invitation` → `membership` → `place_ownership` → `place_domain` →
`place` → `app_user`). `app_system` no podría: `place_ownership` es
WORM-via-DEFINER (ADR-0035) y el resto es RLS owner-only. La cuenta de
`neon_auth."user"` se barre best-effort (schema gestionado por Neon Auth; como
cada email es único por timestamp, un leftover no rompe runs futuros).

Usar emails únicos (timestamp) hace cada run aislado aunque el cleanup previo
fallara.

### Decisiones de config (`playwright.config.ts`)

- **`workers: 1` + `fullyParallel: false`**: el branch `test` cold-startea varios
  segundos en el primer connect (WebSocket neon-serverless). Serial evita
  contención de pool + flakiness; no es una limitación a "tapar".
- **`retries: 2` + timeouts generosos** (`timeout: 60s`, `expect: 15s`): absorben
  el cold-start, no flakiness real.
- **Projects `chromium` + `webkit`**: cobertura de los 2 engines que más divergen.

### Mock de Vercel en E2E (Phase 2.B.1)

El E2E de **register custom domain** (`register-custom-domain.spec.ts`) ejercita
el flujo owner → `/settings/domain` → vincular → `pending` → `verified` →
remover. Los Server Actions del slice (`registerCustomDomainAction`,
`getCustomDomainStatus`) llaman a la **Vercel Domains REST API desde el server
Node** — Playwright (browser) no puede interceptar ese fetch.

Solución (seam DI, sin lógica de test en el código de negocio): el wrapper
`src/shared/lib/vercel/domains-shared.ts` lee el host destino de
`VERCEL_API_BASE_URL` (default `https://api.vercel.com`). En E2E lo apuntamos a
un **stub HTTP local** (`scripts/e2e-vercel-stub.mjs`) que `playwright.config.ts`
arranca como un segundo `webServer`. El stub responde:

- `addDomain` (POST v10) → `verified:false` → el registro queda **pending** con
  tabla DNS.
- `getDomainConfig` (GET v6) → `misconfigured:false` → DNS OK.
- `getDomainStatus` (GET v9) → `verified:true` → en el **reload** el lazy poll
  (`verified && !misconfigured`, ADR-0029) hace `UPDATE verified_at` →
  **verified**.

El flip `pending→verified` es determinístico: el registro usa `addDomain`
(verified:false) y sólo el reload llama `getDomainStatus` (verified:true). Las
creds (`VERCEL_API_TOKEN`/`VERCEL_PROJECT_ID`) se inyectan como mock — el stub
ignora auth. Producción nunca setea `VERCEL_API_BASE_URL` → cae al default real.

### E2E accept invite cross-domain (Phase 2.B.2)

El E2E más frágil del V1.2 (`accept-invite-cross-domain.spec.ts`): un invitee
aterriza en el invite link de un place **con custom domain verificado**, se crea
cuenta en el apex, y acepta la invitación **desde el custom domain** (sesión
local SSO, registrable domain distinto del apex). Custom domain =
`127.0.0.1.nip.io` (A-record IPv4-only; `localtest.me` trae AAAA → happy-eyeballs
puede pegarle a `::1` y flakear). El cert E2E lo cubre en su SAN.

**Camino activo: fallback documentado (cadena SSO live sustituida).** La cadena
live (init→issue→redeem) es **intratable** en el harness local `:3000`: las
rutas SSO (`buildSsoInitUrlForInvite`, `sso-issue` `buildRedeemUrl`, `sso-redeem`
`buildLandingUrl`) reconstruyen el host del custom domain **sin puerto**
(`https://<host>/...` → `:443`) — correcto para producción, roto cuando todo
corre en `:3000`. Arreglarlo exigiría tocar código de producción de routing
(fuera de scope de un test) o correr en `:443` (privilegiado, inviable en CI), y
el flaky-risk del redirect chain cross-registrable-domain con TLS self-signed
violaría el acceptance "0 flaky".

Por eso **sustituimos sólo los 3 hops del redirect SSO** — ya cubiertos por sus
`route.test.ts` (sso-init/issue/redeem) — minteando la cookie
`__Host-place_sso_session` que el redeem habría emitido (`mintLocalSession`,
misma signing key del apex) e inyectándola en el custom domain
(`context.addCookies`). **Todo lo demás corre real**: signup del owner (wizard) +
signup del invitee (apex AccessFlow, cuenta sin place) + seed del `place_domain`
verified + invitación (DEFINER `app.create_invitation`) + routing custom-domain
del proxy + `verifyLocalSession` + `acceptInvitationAction` cross-domain +
consumo del token (re-visita → 404). Bonus del fallback: no ejecuta el self-fetch
JWKS → **no** requiere `NODE_TLS_REJECT_UNAUTHORIZED=0`.

Aserciones (independientes de la nav post-success, que apunta a un `placeHomeUrl`
sin puerto que NO seguimos): (1) anon ve la variante unauth en el custom domain,
(4) con sesión local ve la variante **match** (Aceptar) — render autenticado
cross-domain, (5) `membership` creada en el DB, (6) re-visita → 404.

**Seed (`_support/db-seed.ts`)**: conexión admin (`DATABASE_URL_MIGRATE`, espejo
de `db-cleanup.ts`). Siembra `place_domain` verified vía INSERT y la invitación
vía la DEFINER canónica con el claim `request.jwt.claims` spoofeado tx-local al
`auth_user_id` del owner (`set_config`, forma estándar de invocar una función
SECURITY DEFINER como un usuario concreto en seeds). `neondb_owner` es dueño de
la función → la ejecuta pese al REVOKE FROM PUBLIC. Requiere
`PLACE_SSO_SIGNING_KEY` + `PLACE_SSO_SIGNING_KEY_KID` en `.env.e2e` (server para
verificar, runner para mintear). El cleanup barre `place_domain` + `invitation` +
`membership` por patrón de email.

### Bootstrap compartido del owner

`_support/bootstrap.ts` (`signUpOwner`) corre el wizard de signup completo y
devuelve `{email, slug, …}`. Lo usan los specs que necesitan partir de un owner
autenticado (signup-happy-path lo verifica; register-custom-domain lo reusa como
bootstrap). Crear el owner vía el wizard evita seedear un usuario "login-able" en
el backend gestionado de Neon Auth (que las factories deliberadamente no crean,
decisión 1.C). La sesión queda con `Domain=.lvh.me` → viaja a los subdominios.

### Estructura de archivos

```
tests/e2e/
  signup-happy-path.spec.ts        # E2E #1: place-first signup → create → success
  register-custom-domain.spec.ts   # E2E #2: none → pending → verified → none (stub Vercel)
  accept-invite-cross-domain.spec.ts # E2E #3: anon invite → signup → accept en custom domain
  _support/
    bootstrap.ts                   # signUpOwner — wizard de signup compartido
    db-cleanup.ts                  # cleanupE2EData + E2E_EMAIL_PATTERN (canon)
    db-seed.ts                     # seed place_domain+invitación + mint sesión SSO local (E2E #3)
    global-setup.ts                # pre-clean defensivo
    global-teardown.ts             # barrido post-run
scripts/
  e2e-vercel-stub.mjs              # stub HTTP de la Vercel Domains API (webServer #2)
```

### Cómo correr

| Comando        | Qué hace                                              |
| -------------- | ---------------------------------------------------- |
| `pnpm e2e`     | Corre la suite headless (levanta `pnpm dev` solo).   |
| `pnpm e2e:ui`  | Modo UI interactivo de Playwright (debug visual).    |

### CI

`.github/workflows/e2e.yml` corre la suite, pero es **`workflow_dispatch`
(manual)** — NO en cada PR. Rationale: el E2E levanta la app + cold-startea el
branch Neon (lento + costoso) y los gates baratos (typecheck/lint/vitest) ya
protegen cada PR. Se dispara on-demand antes de un release o tras tocar flujos
críticos (wizard, auth, routing). Requiere los GitHub Secrets del branch `test`
(ver header del workflow).
