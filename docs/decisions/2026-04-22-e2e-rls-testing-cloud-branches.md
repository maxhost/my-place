# ADR — E2E + RLS testing sobre Supabase Cloud (my-place + branches en CI)

**Fecha:** 2026-04-22
**Estado:** Aceptado
**Sub-milestone:** C.H (Fase 5 — Discussions)

## Contexto

Fase 5 cerró la funcionalidad de Discussions pero el sub-milestone C.H es el que
instala la red de seguridad que esa fase asume:

1. **E2E Playwright** — flujos reales en browser (chromium + mobile-safari) sobre
   los caminos felices y negativos del producto.
2. **RLS tests directos** — 63+ casos sobre las 16 policies que protegen las 6
   tablas de discussions, simulando `auth.uid()` distintos.

Hasta antes de C.H, los tests e2e eran 8 smokes que no tocaban RLS, y el job
CI corría contra un `postgres:16` pelado sin schema `auth` — las migraciones
de RLS **ni siquiera se aplicaban** correctamente ahí, o sea que el workflow
"verde" estaba mintiendo.

El plan original (`docs/plans/2026-04-21-c-h-e2e-rls-testing.md`) proponía
crear un proyecto Supabase Cloud dedicado `place-test`. Esta ADR documenta la
adaptación real implementada.

## Alternativas consideradas

### A — `supabase start` local con CLI + Docker

Levantar el stack completo (Postgres 15 + GoTrue + Realtime) via `supabase
start` en dev y CI. Máxima fidelidad con prod. **Descartada** porque:

- Requiere Docker Desktop en local — prereq pesado que no aporta para una
  demo MVP.
- El CLI de Supabase tiene drift con Cloud (versiones de auth, políticas de
  branching), lo que introduce falsos positivos cuando algo funciona local
  pero no en Cloud.
- Añade ~30s de spinup en cada ejecución local.

### B — Proyecto Cloud dedicado `place-test`

Crear un proyecto separado, 100% throwaway, apuntado por vars `TEST_*`.
**Descartada** porque:

- Duplica costo de Cloud por un proyecto que se usa solo en tests.
- El MCP ya está conectado a `my-place` (el proyecto dev); crear otro
  rompería la consistencia del workflow de Claude Code.
- El dev DB de Place tiene poca data (3 users, 1 place) — el blast radius
  real es bajo si tests accidentalmente tocan lo que no deben.

### C — Postgres vanilla + emular schema `auth` a mano

Mantener `postgres:16` en CI e inyectar manualmente `auth.users`,
`auth.uid()`, triggers de sessions. **Descartada** porque:

- Gran superficie de drift. Supabase ships con 76 migraciones en
  `auth.schema_migrations` — imposible mantener un fake equivalente.
- RLS policies usan `auth.uid()::text` que referencia el claim JWT; sin el
  setup completo las policies compilan pero no se ejercitan.

### D — JWT forging con `jose` + secret dummy

Firmar JWTs con HS256 usando `SUPABASE_JWT_SECRET` dummy para que el API
Supabase los acepte. **Descartada** porque:

- Playwright necesita cookies emitidas por el Auth server real para que
  middleware y `createSupabaseServer()` las acepten. Mintir JWTs divergente
  del path productivo.
- Agrega una dep (`jose`) sólo para tests.
- Para los RLS tests directos no se necesita firmar — `SET LOCAL
request.jwt.claims` directo es más simple.

## Decisión

**Dos estrategias de aislamiento, una sola fuente de verdad (`my-place`):**

| Dimensión         | Local (dev + `pnpm test:e2e`)                                                     | CI (GitHub Actions)                                                            |
| ----------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Proyecto Supabase | `my-place` main                                                                   | Branch efímera de `my-place` por run                                           |
| Credenciales      | `.env.local` + `E2E_TEST_SECRET`                                                  | GH Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `E2E_TEST_SECRET` |
| Aislamiento       | Places `place_e2e_*` + emails `e2e-*@e2e.place.local` (dev `the-company` intacto) | Branch total — main intacto                                                    |
| Reset             | `resetContent(placeId)` con guard prefix                                          | Branch limpia por run + auto-delete                                            |

### Mecanismos clave

1. **Prefijos reservados**: emails `/^e2e-.*@e2e\.place\.local$/` y place IDs
   `/^place_e2e_/`. Seed y helpers asertan prefijo antes de borrar. Guard
   defensivo en `reset-content.ts`.
2. **"JWT alterno"** del roadmap = `SET LOCAL request.jwt.claims`. El harness
   RLS abre tx, seed como `postgres` super, cambia a rol `authenticated`,
   setea claim via `set_config('request.jwt.claims', <json>, true)`,
   ejecuta queries. `ROLLBACK` garantiza cero writes persistentes.
3. **Endpoint `/api/test/sign-in`** con gate doble: `NODE_ENV === 'production'`
   → 404 sin leer body; header `x-test-secret` ausente/mismatch → 404 (no
   401, evita enumeración). Reutiliza el pattern de `dev-actions.ts`
   (`admin.generateLink` → `verifyOtp`). Consumido por `tests/global-setup.ts`.
4. **Branches en CI** via Management API (`scripts/ci/branch-helpers.sh`):
   `create_branch → poll_until_active → fetch_branch_env → delete_branch`.
   `if: always()` en cleanup + `concurrency.cancel-in-progress` evitan leaks.
5. **Puerto 3001** en dev server local para no colisionar con otros dev
   servers del usuario en el mismo host (ej: proyecto paralelo en 3000).
   CI usa el mismo puerto por consistencia; cookies se comparten via `Domain=lvh.me`
   (cookie-domain strippea puerto).

### Tradeoffs aceptados

- **Cost de branching en CI**: ~$0.32/hr × ~5min/run ≈ $0.03/run. 100 runs/mes
  ≈ $3. Aceptable.
- **Dev DB compartido para tests locales**: un bug en seed/reset que escape
  del prefijo podría borrar `the-company`. Mitigado con `assertE2EPlaceId` y
  code review estricto en helpers.
- **Branching requiere plan Pro+**: confirmado habilitado en `my-place`.
- **Branches no replican data, solo schema**: seed corre fresh en cada CI
  run. Aceptable — seed es idempotente.

## Implementación

### Archivos clave

- `tests/fixtures/e2e-data.ts` — constantes prefijadas (emails, place IDs).
- `tests/fixtures/e2e-seed.ts` — seed aditivo FK-safe, wipe restringido.
- `tests/rls/harness.ts` — `pg.Pool` + `withUser` helpers.
- `tests/rls/*.test.ts` — 7 specs cubriendo 72 casos.
- `src/app/api/test/sign-in/route.ts` — endpoint con gate doble.
- `src/app/api/test/sign-in/__tests__/route.test.ts` — 9 casos unit.
- `tests/global-setup.ts` — seed + login de 6 roles a storageState.
- `tests/helpers/{subdomain,playwright-auth,time,reset-content}.ts`.
- `tests/e2e/smoke/*` — smokes existentes + nuevo auth-storageState.
- `tests/e2e/flows/post-crud.spec.ts` — MVP flow con storageState + subdomain.
- `scripts/ci/branch-helpers.sh` — Management API wrapper.
- `.github/workflows/ci.yml` — job `e2e` con create/delete branch.
- `vitest.rls.config.ts` — config separada (`environment: node`, excluye del
  main `pnpm test`).

### Matriz de cobertura RLS (ejercitada por 72 casos)

| Tabla               | active member | ex-member | admin     | owner | non-member |
| ------------------- | ------------- | --------- | --------- | ----- | ---------- |
| Post SELECT visible | ✓             | ✗         | ✓         | ✓     | ✗          |
| Post SELECT hidden  | ✗             | ✗         | ✓         | ✓     | ✗          |
| Post INSERT self    | ✓             | ✗         | ✓         | ✓     | ✗          |
| Post UPDATE author  | ✓             | ✗         | ✓ (admin) | ✓     | ✗          |
| Post DELETE         | ✗             | ✗         | ✗         | ✗     | ✗          |
| Comment × 5         | idem Post     |           |           |       |            |
| Reaction × 4        | idem          |           |           |       |            |
| Flag SELECT own     | ✓             | ✓         | ✓         | ✓     | ✗          |
| Flag UPDATE         | ✗             | ✗         | ✓         | ✓     | ✗          |
| PostRead × 2        | idem          |           |           |       |            |
| PlaceOpening SELECT | ✓             | ✗         | ✓         | ✓     | ✗          |
| PlaceOpening mutate | ✗ (todos)     |           |           |       |            |

Todos los casos fueron verificados contra policies instaladas en `my-place`
(no contra el archivo `migration.sql`, que contiene una branch de `deletedAt`
en Post SELECT que no existe en la policy instalada — discrepancia anotada
como observación, sin fix hoy porque el comportamiento vigente es el
correcto).

## Flows E2E implementados en C.H (subset inicial)

- `smoke/auth.spec.ts` (4 × 2 browsers)
- `smoke/auth-storageState.spec.ts` (1 × 2)
- `smoke/health.spec.ts` (1 × 2)
- `smoke/middleware-routing.spec.ts` (3 × 2)
- `flows/post-crud.spec.ts` (3 × 2)

**Total: 24 tests verdes en local (chromium + mobile-safari).**

## Diferido a C.H.1 (follow-up)

El plan original listaba 6 spec files de flows. Implementado MVP; los
restantes son mecánicos sobre la infraestructura ya montada. Agendados para
C.H.1 (no bloquean el cierre de C.H):

- `flows/comment-reactions.spec.ts` — comentar, reaccionar, quitar reacción,
  paginación keyset del thread.
- `flows/moderation.spec.ts` — flag → queue admin → ignore/hide/delete +
  flag duplicado rechazado.
- `flows/invite-accept.spec.ts` — admin invita → FakeMailer captura URL →
  otro user acepta → aparece en members.
- `flows/hours-gate.spec.ts` — admin cierra place → member ve "cerrado" →
  admin mantiene `/settings/*` → reabre.
- `flows/admin-inline.spec.ts` — PostAdminMenu + CommentAdminMenu (C.G.1).
- `backdatePost` test de ventana 60s (infra lista en `tests/helpers/time.ts`).

## Riesgos y mitigaciones

| Riesgo                              | Mitigación                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` expira      | Error explícito en CI (`curl -f` falla con 401) — rotación manual documentada.                          |
| Branch leaked si CI killed          | `if: always()` delete + concurrency group. Script periódico de cleanup pendiente (no-C.H).              |
| Costo branching                     | ~$3/mes @ 100 runs. Monitorear en Supabase billing.                                                     |
| Seed accidental sobre `the-company` | Triple guard: prefix check en assert, WHERE con prefix en wipe, placeKey typed union en `resetContent`. |
| `/api/test/sign-in` filtra en prod  | Gate doble testeado unit (9 casos).                                                                     |
| CI monta Next en `production`       | `NODE_ENV: test` explícito en job env + webServer env del playwright.config.                            |

## Verificación

- ✅ `pnpm test` — 546 unit tests (incluye 9 del route handler).
- ✅ `pnpm test:rls` — 72 casos directos sobre 16 policies + 2 helpers.
- ✅ `pnpm test:e2e` — 24 tests × 2 browsers, globalSetup verde.
- ✅ Post-run: `the-company` y users non-E2E intactos en `my-place`.
- ⏳ CI verde end-to-end — verificable al push del PR.

## Post-C.H

Fase 5 cerrada funcional + con red. Fases candidatas:

- Fase 6 — Eventos.
- Fase 3 — Billing (Stripe Connect).
- Fase 7/8 — Portada / Landing.
- Fase 4 — Feature flags (habilita rollout progresivo de Fase 3).
