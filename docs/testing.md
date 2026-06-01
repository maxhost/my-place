# Testing

Estrategia de tests de Place y cómo correr cada capa. Doc canónico: la config de
Playwright, `next.config.ts` y `.env.e2e.example` apuntan acá para el rationale.

> **Última actualización:** 2026-05-31 (Phase 2.A tech-debt — setup E2E Playwright).

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

### Estructura de archivos

```
tests/e2e/
  signup-happy-path.spec.ts     # E2E #1: place-first signup → create → success
  _support/
    db-cleanup.ts               # cleanupE2EData + E2E_EMAIL_PATTERN (canon)
    global-setup.ts             # pre-clean defensivo
    global-teardown.ts          # barrido post-run
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
