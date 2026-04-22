# C.H — E2E Playwright + RLS tests directos con JWT alterno

## Estado de ejecución (para retomar tras restart)

**Último update:** 2026-04-21, Fase 0 en curso.

### Qué está hecho

- Plan aprobado tras auditoría (gaps cubiertos: backdate helper para edit-window 60s, `NODE_ENV=test` explícito en CI, config Supabase local con redirect URLs, gitignore entries, interpretación explícita de "JWT alterno" como `SET LOCAL request.jwt.claims`).
- Decisión clave: **sin Docker local**. Usamos Supabase Cloud vía MCP en lugar de `supabase start`. Estrategia: proyecto Cloud dedicado `place-test` en la cuenta de Place (distinta a la cuenta `55mais-dev` que ya tenía MCP conectado).
- `.mcp.json` agregó entry `supabase-place` apuntando a `https://mcp.supabase.com/mcp?project_ref=pdifweaajellxzdpbaht`. Coexiste con la entry `supabase` (55mais-dev) sin tocarla.

### Próximo paso al retomar

1. Verificar que la MCP `supabase-place` autenticó OK con la cuenta de Place (tool `mcp__supabase-place__list_projects` debería listar el project `pdifweaajellxzdpbaht` / "my-place" + cualquier otro).
2. Crear proyecto Cloud nuevo `place-test` en esa cuenta (confirmación de costo requerida — `mcp__supabase-place__get_cost` → `mcp__supabase-place__confirm_cost` → `mcp__supabase-place__create_project`). Region: `us-west-2` (igual que el dev actual).
3. Aplicar migraciones Prisma sobre `place-test` vía connection string directo — las migraciones de RLS dependen del schema `auth` que Supabase Cloud provee nativo (a diferencia del `postgres:16` plain del CI actual, raíz del CI silenciosamente roto).
4. Adaptar secciones del plan originalmente basadas en `supabase start` local:
   - **Fase 1 (infra Supabase)** → ya no `supabase init` + `config.toml`. En su lugar: documentar conexión a `place-test` + vars `TEST_DATABASE_URL`, `TEST_DIRECT_URL`, `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY` en `.env.example` + GitHub Secrets.
   - **Fase 5 (CI)** → reemplazo de `postgres:16` service por **no** service; CI se conecta directo al `place-test` Cloud con secrets. Cada job resetea el DB vía script custom de truncate.
   - **Sección 6 (CI upgrade)** del plan queda desactualizada en la parte `supabase start` / `supabase/config.toml`. Se reescribe en Fase 5 real.
5. Continuar TDD por fases (endpoint test-auth → seed → RLS harness → E2E specs).

### Archivos tocados esta sesión

- `.mcp.json` — agregada entry `supabase-place`.
- `docs/plans/2026-04-21-c-h-e2e-rls-testing.md` (este archivo) — copia persistente del plan.

### Gotchas del approach Cloud-test (a documentar en ADR de Fase 6)

- **Aislamiento:** los tests corren contra un Cloud project real compartido entre runs. CI debe **no** correr en paralelo a la misma region/project o habrá race en seed. Serialización via GitHub Actions `concurrency: group: e2e-cloud` cancela el run anterior.
- **Reset pre-run:** el `globalSetup` de Playwright debe borrar + re-seedear cada run. Con Cloud el TRUNCATE es relativamente rápido; 6 tablas del slice + User/Place/Membership.
- **Credenciales test-only vs prod:** el project `place-test` es 100% throwaway; su service role puede vivir en GH Secrets sin drama. Pero **nunca** usar esas credenciales en dev local inadvertidamente — `.env.local` apunta a `my-place`, `.env.test` a `place-test`; se diferencia por `NODE_ENV === 'test'` en `global-setup.ts`.

---

## Context

Fase 5 (Discussions) está cerrada funcionalmente (C.A–C.G.1 ✅). El último sub-milestone pendiente es **C.H**, que añade la capa de verificación end-to-end que Fase 5 se diseñó para exigir: (a) flujos reales de usuario en browser y (b) enforcement directo de RLS sobre las 6 tablas del slice (Post, Comment, Reaction, PlaceOpening, PostRead, Flag) simulando `auth.uid()` distintos.

Hoy tenemos 8 tests E2E humo (landing, login redirects, middleware routing) y **cero tests reales de RLS** — toda la cobertura de policies es indirecta (la app capa hace gate + queries con service role, pero nadie confirma que RLS bloquea a un ex-miembro que intente `SELECT` directo). Eso es un gap crítico: RLS es defensa en profundidad para multi-tenant; sin tests directos, una regresión silenciosa en una policy puede filtrar datos entre places sin que un solo test unit falle.

Además, el pipeline CI actual tiene un problema de raíz: el job `e2e` levanta `postgres:16` a pelo y corre `prisma migrate deploy`. **Las migraciones de RLS usan `auth.uid()` que no existe en Postgres vanilla** — o el job está silenciosamente roto, o nunca se ejercitó la migración de discussions ahí. C.H lo arregla montando Supabase local (stack completo: Postgres + Auth + Realtime) vía la CLI oficial, con lo que cualquier test corre contra un entorno que es byte-a-byte el mismo que producción.

El objetivo al cerrar C.H: poder refactorear policies, schema o flows con un guardián que detecte regresiones **antes** del primer user report.

## Alcance

Dos suites separadas, una misma infraestructura (Supabase local + CI upgrade):

1. **E2E Playwright** — escenarios de browser real sobre los caminos felices y negativos del producto (invite, post CRUD, comment CRUD, reacciones, flag + review, hours gate, moderación inline).
2. **RLS directos (JWT alterno)** — suite Vitest nueva que usa `pg` crudo sobre `DIRECT_URL` y `SET LOCAL request.jwt.claims = …` para simular distintos `auth.uid()` por caso. Matriz por tabla × rol × acción.

Fuera de scope: Realtime E2E (solo humo), Billing/Stripe E2E (Fase 3), accesibilidad automática con axe (agendado aparte), carga/performance.

## Decisiones de producción-robustez

### 1. Supabase local (CLI) en dev y CI — no emulador casero ni mocks

`supabase start` levanta el stack completo (Postgres 15, GoTrue Auth, Realtime, Storage, PostgREST) en Docker. Cada test corre contra el mismo software que producción — mismas policies, mismo JWT signing, mismos triggers. El CI agrega ~30s de startup pero elimina la divergencia "funciona en prod pero no en tests" que el approach actual (mocks + postgres vanilla) no cubre.

**Por qué no JWT forging casero:** mintar JWTs con `jose` usando un `SUPABASE_JWT_SECRET` dummy funciona para RLS directos pero no para E2E — Playwright necesita cookies emitidas por el Auth server real para que middleware y `createSupabaseServer()` acepten la sesión. Divergir el path de auth en tests vs prod introduce bugs que solo aparecen al hacer deploy. Supabase local cierra ese gap de un solo golpe.

### 2. Dos conexiones DB distintas por test target

- **E2E (Playwright)** — el app server corre con `DATABASE_URL` apuntando al pooler de Supabase local (puerto `54321` vía supavisor compat, `pgbouncer=true`). Tests ejercen código real del app.
- **RLS directos** — conexión `pg` separada sobre **`DIRECT_URL`** (session mode, puerto `5432` local). `SET LOCAL request.jwt.claims = '{...}'` **requiere** session mode; transaction pooler no persiste el claim entre queries de la misma tx. Esto queda documentado explícitamente en CLAUDE.md.

### 3. Seed E2E separado + reset estratificado por scope

`prisma/seed.ts` hoy crea 1 user + 1 place (`prueba`). E2E necesita fixture determinista más rico: 2 places, 6 users con roles distintos (owner, admin, memberA, memberB, ex-member, non-member), memberships, un post baseline, un comment, horas abiertas 24/7. Nuevo script **`tests/fixtures/e2e-seed.ts`** (tsx) idempotente: `deleteMany` en orden FK-safe y recrea. IDs estables (`usr_e2e_owner`, `place_e2e_palermo`) permiten aserts directos.

**Estrategia de reset (gap identificado en auditoría):**

- **Seed baseline** se corre una vez en `globalSetup` antes del primer test.
- **Por spec file** (`test.describe.configure({ mode: 'serial' })` + `beforeAll`/`afterAll`): el spec declara qué entidades muta y las resetea vía helper `resetContent(placeId)` que borra Post/Comment/Reaction/Flag/PostRead de ese place y regenera el post baseline. NO resetea users/memberships/ownership/opening. Acotado al place del spec para no correr un full wipe.
- **Especialización por spec**: specs que asumen "no hay posts" empiezan con `resetContent`; specs que solo leen entities estables (users, memberships) no necesitan reset.
- **Aislamiento por place**: cada spec trabaja en `place_e2e_palermo` o `place_e2e_belgrano` (dos places en el seed) — tests que podrían interferir se reparten entre los dos para correr en paralelo.
- **RLS directos**: cada caso abre tx + `SET LOCAL request.jwt.claims` + query + `ROLLBACK` en `afterEach`. Sin pollution.

**Por qué no transactional rollback en E2E:** Playwright hace HTTP reales al app server; el server abre sus propias conexiones Prisma, no comparte tx con el runner. `resetContent` compensa.

### 3b. Edit-window 60s + fechas: backdate quirúrgico en DB

El edit window de 60s es una invariante que E2E debe verificar en ambos lados ("edita <60s OK", "edita >60s denied"). Esperar 60s reales en un spec es inaceptable.

**Approach**: helper `backdatePost(postId, delta: string)` en `tests/helpers/time.ts` que hace `UPDATE "Post" SET "createdAt" = "createdAt" - $delta WHERE id = $postId` vía `@/db/client` directo (con service role efectivo a nivel Prisma, no via API). Specs usan: `await backdatePost(postId, '2 minutes')` → el post aparece creado hace 2min → la action debería rechazarlo con `EditWindowExpired`.

No se mockea reloj del server (fragil, requiere inyección de dependencia no presente). No se toca el código productivo. Solo la DB del test.

### 4. Playwright `storageState` por rol + gate doble en el endpoint test

`globalSetup` de Playwright hace login programático de cada usuario seed vía **endpoint de test-only `POST /api/test/sign-in`**. El endpoint crea la sesión vía `supabase.auth.admin.generateLink` + `verifyOtp` (mismo flow que `devSignIn`), devuelve Set-Cookie, y Playwright lo persiste a `tests/.auth/<role>.json`.

Cada test declara `test.use({ storageState: 'tests/.auth/admin.json' })` — **zero cost auth per test**. Tests concurrentes no pelean por login.

**Gate del endpoint (auditoría corrigió el "triple gate"):** dos checks reales, no tres:

1. **Build-time**: el handler hace `if (process.env.NODE_ENV === 'production') return new Response(null, { status: 404 })` en línea 1. El file bundler en prod sigue existiendo pero responde 404 indistinguible de ruta inexistente.
2. **Runtime**: header `x-test-secret` debe coincidir con `E2E_TEST_SECRET` env; si no coincide → 404 (NO 401, para no leak enumeración).

No se agrega rule de middleware específica porque (a) duplicaría el check, (b) introduciría un punto donde olvidarlo deja el endpoint abierto. Gate está en el propio handler.

**Verificación de gate**: test unit `src/app/api/test/sign-in/__tests__/route.test.ts` con 3 casos: `NODE_ENV=production` → 404 sin leer body; missing header → 404; OK → 200 + Set-Cookie.

**Mobile Safari + storageState** (auditoría): Playwright `webkit` emulado carga cookies de `storageState` correctamente si el baseURL matches. Validación en el golden path: el spec humo `tests/e2e/smoke/auth.spec.ts` corre en ambos browsers — si Safari rompe, se detecta inmediatamente (no al agregar 200 tests).

### 5. "JWT alterno" para RLS: claims directos, no firma — interpretación explícita

**Interpretación (auditoría)**: "JWT alterno" en el roadmap significa "simular distintos `auth.uid()` por test caso", NO "mintar JWTs firmados". RLS usa `auth.uid()` que lee de `current_setting('request.jwt.claims', true)::json->>'sub'`. Setear ese claim directo es el patrón oficial Supabase documentado para testing de RLS.

**Cómo funciona el harness**:

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"usr_e2e_memberA","role":"authenticated"}';
-- queries del test (SELECT/INSERT/UPDATE/DELETE bajo las RLS policies)
ROLLBACK;
```

**Sin firma, sin libs nuevas**: no se usa `jose` ni `jsonwebtoken`. `auth.uid()` no verifica firma, solo lee el claim. Menos superficie, menos deps.

**`SET LOCAL ROLE authenticated`**: crítico para que las policies aplicadas a role `authenticated` disparen. Sin esto, caerías a `service_role` por default de Prisma, que bypassea RLS. El harness documenta esto en el header del archivo.

**Equivalencia con app runtime**: Supabase en runtime también setea `request.jwt.claims` desde el JWT decodificado antes de ejecutar queries autenticadas. El harness simula exactly ese setup — misma semántica, sin overhead de auth network round-trip.

### 6. CI upgrade: Supabase local vs Postgres pelado

El job `e2e` actual con `postgres:16` se reemplaza por:

1. Instala `supabase` CLI vía `supabase/setup-cli@v1` con **versión pinneada explícita** (`version: 1.x.y` — se fija en la fase 1 tras verificar que levanta Postgres 15 igual que el target prod).
2. `supabase start` (levanta Postgres 15 + GoTrue + Realtime).
3. **Extrae env** con `supabase status --output env > .env.supabase && cat .env.supabase >> $GITHUB_ENV`. Verificado en Fase 0 que esta sintaxis existe en la versión pinneada; si no existiera en alguna versión, fallback: parsear `supabase status` con `jq` sobre output JSON (`--output json`).
4. **Fuerza `NODE_ENV=test`** en el step (auditoría): `env: NODE_ENV: test` explicit para que el app server arrancado por Playwright no se monte en modo `production` (donde `/api/test/sign-in` devuelve 404).
5. `pnpm prisma migrate deploy` — contra Postgres real con schema `auth`.
6. `pnpm tsx tests/fixtures/e2e-seed.ts`.
7. `pnpm test:e2e && pnpm test:rls` — secuenciales para aislar failure attribution.
8. `supabase stop` en `if: always()`.

Los env dummy `test-anon-key` / `test-service-role-key` se eliminan del workflow — los reales vienen de `supabase status`.

**Docker requerement**: GitHub Actions `ubuntu-latest` incluye Docker out of the box. Dev local requiere **Docker Desktop** (mac) o Docker Engine (linux). Se documenta en CLAUDE.md Gotchas como prereq para correr E2E local.

### 6b. Config Supabase local (auditoría corrigió gap)

`supabase/config.toml` debe incluir **explícitamente**:

- `[auth]` → `site_url = "http://lvh.me:3000"`, `additional_redirect_urls = ["http://*.lvh.me:3000/**"]`. Sin esto, los magic-links que Playwright consume redirectean a URL default y el test falla.
- `[auth.email]` → `enable_confirmations = false` (dev fricción-free) + `enable_signup = true`.
- `[realtime]` → `enabled = true`, y la Realtime Authorization toggle se setea vía migración SQL o comentario ADR con instrucción dashboard-like para local (la CLI no expone el toggle directo aún — se maneja via SQL `ALTER ROLE authenticated SET "pgrst.jwt_secret"` patrón si hiciera falta; por ahora el test de Realtime queda fuera de C.H).
- `[db]` → `port = 54322` (session pool), `[db.pooler]` → `port = 54321` (transaction). Matches semantics prod.

El archivo completo se commitea al repo. CI y dev local usan el mismo.

### 7. Test code no rompe boundaries

`tests/e2e/**` y `tests/rls/**` importan de `@/features/*/public(.server)` únicamente — jamás de internals. ESLint ya lo enforcea via `no-restricted-imports` (no hay exempción para `tests/`). `tests/boundaries.test.ts` no cambia.

**Excepción técnica**: los seed fixtures SÍ necesitan escribir directo en Prisma (crear users/places/memberships bypasseando la action layer, porque las actions requieren sesión que no existe pre-seed). `tests/fixtures/e2e-seed.ts` importa `@/db/client` directo — documentado en header del archivo como "scaffolding-only, no app code".

### 8. Observabilidad de tests

- Playwright `trace: 'on-first-retry'` ya configurado; agregamos `screenshot: 'only-on-failure'` y `video: 'retain-on-failure'` para debugging CI.
- Suite RLS usa `describe.each()` con títulos descriptivos (`Post RLS / active member / can SELECT own post`) para grep-friendliness.
- Cada suite emite un summary al final: matriz rol × tabla × acción con ✓/✗.

### 9. Higiene de repo (auditoría)

Nuevas entradas en `.gitignore`:

```
# Supabase local runtime
supabase/.branches/
supabase/.temp/
supabase/seed.sql

# Playwright auth state
tests/.auth/
test-results/
playwright-report/
```

Se commitea `supabase/config.toml` (fuente de verdad del stack) pero nunca los runtime artifacts.

### 10. Interacción con gotchas existentes de CLAUDE.md

- **pgbouncer**: E2E corre contra el pooler local (port `54321`, transaction mode). El app server Prisma necesita `DATABASE_URL=postgresql://...:54321/...?pgbouncer=true&connection_limit=1` — idéntico al pattern prod. `DIRECT_URL` va al puerto session (`54322`) solo para migraciones y para el harness RLS.
- **`DATABASE_URL` cambios → reiniciar dev server**: irrelevante en CI (server fresco por job). Para DX local, se documenta que después de `supabase:reset` hay que matar `pnpm dev` y volver a arrancarlo (`PrismaClient` cacheado en `globalThis`).
- **"Allow public access to channels" OFF**: gotcha existente relevante para Realtime. C.H NO cubre Realtime E2E, pero el plan deja documentado que si en una fase futura se agregan tests de Realtime, hay que setear el toggle en Supabase local — probablemente via `supabase/config.toml [realtime]` o SQL de post-migración.
- **Slice con `server-only`**: ningún archivo nuevo de test tiene `import 'server-only'`. El endpoint `/api/test/sign-in` es un handler Next, no un module `server-only`. No se cruza el boundary.

## Archivos

### Nuevos

1. `supabase/config.toml` (~80, generado por `supabase init`) — config del stack local.
2. `tests/fixtures/e2e-seed.ts` (~180) — siembra determinista. IDs estables. Idempotente (wipe + re-seed en orden FK-safe).
3. `tests/fixtures/e2e-data.ts` (~40) — constantes (IDs, emails, place slugs) compartidas entre seed, E2E specs y RLS specs.
4. `tests/helpers/playwright-auth.ts` (~90) — helper `signInAsRole(role)` que apunta al storageState correspondiente. Types strictos sobre roles válidos.
5. `tests/helpers/subdomain.ts` (~30) — `placeUrl(slug, path)` y `appUrl(path)` construyen URLs absolutas contra `PLAYWRIGHT_BASE_URL`.
   5b. `tests/helpers/time.ts` (~40) — `backdatePost(postId, delta)`, `backdateComment(commentId, delta)` vía Prisma directo (usado solo por tests para ejercer ventana de 60s). Documentado como test-only.
   5c. `tests/helpers/reset-content.ts` (~60) — `resetContent(placeId)` borra Post/Comment/Reaction/Flag/PostRead del place y regenera el post baseline del seed. Idempotente.
6. `tests/rls/harness.ts` (~160) — `pg.Pool` sobre `DIRECT_URL`, helper `asUser(userId, role)` que retorna un `client` dentro de una tx con `SET LOCAL request.jwt.claims` y `SET LOCAL ROLE authenticated`. Rollback automático vía `afterEach`.
7. `tests/rls/post.test.ts` (~260) — 18 casos: active member SELECT visible, admin SELECT hidden, ex-member denied, non-member denied, INSERT self-author OK, INSERT otro author denied, UPDATE author OK, UPDATE admin OK, UPDATE otro denied, DELETE denied (todos), service role bypass smoke.
8. `tests/rls/comment.test.ts` (~180) — 12 casos similares al de Post pero sin HIDDEN/DELETED states (comments se hard-delete).
9. `tests/rls/reaction.test.ts` (~130) — 8 casos: INSERT self OK, INSERT otro user denied, DELETE propia OK, DELETE ajena denied, SELECT all members OK, UPDATE denied (no existe policy).
10. `tests/rls/flag.test.ts` (~220) — 14 casos: reporter SELECT own OK, admin SELECT todos OK, member non-reporter denied SELECT de otro, INSERT self-reporter OK, UPDATE admin-only, DELETE denied.
11. `tests/rls/post-read.test.ts` (~110) — 6 casos: INSERT self OK, SELECT own OK, SELECT de otro member OK (via Post.placeId), UPDATE service-role-only denied a members.
12. `tests/rls/place-opening.test.ts` (~90) — 5 casos: SELECT member OK, INSERT member denied (service-role-only), schema check.
13. `tests/rls/helpers-functions.test.ts` (~90) — tests directos sobre `is_active_member(place_id)` e `is_place_admin(place_id)` (sin JWT → false, con JWT member → true, con JWT admin → true en ambos, con JWT owner → admin=true member=true).
14. `tests/e2e/flows/post-crud.spec.ts` (~220) — 7 flows: member crea post → listado lo muestra → detail view → edita <60s OK → edit >60s denied → admin hide → member recibe 404 → admin un-hide.
15. `tests/e2e/flows/comment-reactions.spec.ts` (~180) — 5 flows: member comenta, reacciona, otro member ve la reaction, quita reaction, thread keysets paginan.
16. `tests/e2e/flows/moderation.spec.ts` (~220) — 6 flows: member flaggea post, admin ve queue, admin ignora OK, admin hide desde queue + tx consistente, admin delete desde queue + cascade, flag duplicado falla con copy correcto.
17. `tests/e2e/flows/invite-accept.spec.ts` (~180) — 4 flows: admin invita → email (fake mailer devuelve URL) → invitee accepta en otra session → aparece en members.
18. `tests/e2e/flows/hours-gate.spec.ts` (~150) — 3 flows: admin cierra place → member recibe "cerrado" → admin sigue teniendo /settings/\* → reabre → member vuelve a ver contenido.
19. `tests/e2e/flows/admin-inline.spec.ts` (~140) — 4 flows sobre C.G.1: PostAdminMenu con Editar/Ocultar/Eliminar, CommentAdminMenu con Eliminar, hard-delete cascade visible.
20. `src/app/api/test/sign-in/route.ts` (~75) — endpoint POST gated por `NODE_ENV !== 'production'` + `x-test-secret` header = `E2E_TEST_SECRET`. Body `{ email }`. Hace `admin.generateLink` + `verifyOtp`, devuelve Set-Cookie del session. Retorna 404 si el gate falla (no filtra que existe en prod).
21. `docs/decisions/2026-04-21-e2e-rls-testing.md` (~180) — ADR. Alternativas descartadas (JWT forging, mock-only, Postgres pelado + schema auth pegado a mano). Decisión Supabase local. Tradeoffs (CI +30s, DX `supabase start` local). Matrix de cobertura por tabla.

### Modificados

22. `playwright.config.ts` — agregar `globalSetup: './tests/global-setup.ts'`, `storageState` default (per-project override en specs), timeout 45s (seed reset pesa), `expect.timeout: 10000`.
23. `tests/global-setup.ts` (nuevo, ~90 líneas) — llamado por Playwright antes del primer test: (a) corre `tsx tests/fixtures/e2e-seed.ts`, (b) para cada rol, llama `POST /api/test/sign-in` y persiste cookies en `tests/.auth/<role>.json`.
24. `.github/workflows/ci.yml` — job `e2e` rebuilt: reemplaza `services.postgres` por install `supabase/setup-cli@v1`, `supabase start`, env desde `supabase status`, corre migrate + seed + `test:e2e` + `test:rls`, `supabase stop` en `always()`.
25. `package.json` — agregar `pg` (+ `@types/pg` dev) como dep para el harness RLS. Scripts nuevos: `"test:rls": "vitest run --config vitest.rls.config.ts"`, `"test:e2e:seed": "tsx tests/fixtures/e2e-seed.ts"`, `"supabase:start": "supabase start"`, `"supabase:reset": "supabase db reset"`, `"ci:full": "pnpm ci && pnpm test:e2e && pnpm test:rls"`.
26. `vitest.rls.config.ts` (nuevo, ~30) — config Vitest separada para RLS: `environment: 'node'`, `include: ['tests/rls/**/*.test.ts']`, `testTimeout: 15000`, sin `jsdom`. Importante: NO mezcla con `vitest.config.ts` default (que es `jsdom`) porque `pg` requiere `node`.
27. `.env.example` — agregar `E2E_TEST_SECRET=`, `DIRECT_URL=` con comentario de uso (migrations + RLS harness).
28. `CLAUDE.md` — agregar Gotchas: - "Supabase local (Docker Desktop required) para E2E/RLS: `pnpm supabase:start` primera vez ~2min, luego ~10s. Sin Docker, los tests no corren." - "RLS tests usan `DIRECT_URL` (session mode, port 54322) porque `SET LOCAL request.jwt.claims` no persiste en transaction pooler (`DATABASE_URL` port 54321)." - "Endpoint `/api/test/sign-in` devuelve 404 en prod (gate por `NODE_ENV`) + 404 sin header `x-test-secret` (evita enumeración). No eliminar." - "CI E2E force `NODE_ENV=test` explícito; sin eso, el app server se monta en `production` y 404ea el endpoint de test-auth — toda la suite falla sin diagnóstico obvio."
    28b. `.gitignore` — agregar `supabase/.branches/`, `supabase/.temp/`, `supabase/seed.sql`, `tests/.auth/`, `test-results/`, `playwright-report/`.
29. `docs/roadmap.md` — C.H marcado ✅ con fecha de cierre.
30. `docs/stack.md` — fila Testing actualizada: "Unit/integration con Vitest (jsdom), RLS directos con Vitest (node + `pg`), E2E con Playwright + Supabase local."
31. `docs/features/discussions/spec.md` § nueva "Cobertura de tests (C.H)" — matrix de RLS + lista de flows E2E.
32. `tests/e2e/auth.spec.ts`, `tests/e2e/middleware-routing.spec.ts`, `tests/e2e/health.spec.ts` — se mueven a `tests/e2e/smoke/` por organización (paths cambian, contenido no).

### Eliminados

Ninguno.

## Plan de ejecución (orden estricto)

**Convención:** Cada fase termina con checkpoint `pnpm ci && pnpm test:rls && pnpm test:e2e` verde antes de avanzar a la siguiente.

### Fase 0 — Pre-flight

0.1. Validar `supabase/setup-cli@v1` activo. Pinear versión CLI (probar `supabase start` local, documentar en el plan la versión exacta).
0.2. Confirmar `pg` npm (8.x) con `@types/pg` estables.
0.3. Validar que `supabase status --output env` emite el formato esperado (NAME=value lines). Si no, usar `--output json` + `jq` fallback. Documentar en el script CI.
0.4. Leer `prisma/migrations/20260424000000_realtime_discussions_presence/migration.sql` — fuera del scope RLS directo de C.H (Realtime E2E no se cubre), se documenta como gap visible.
0.5. Verificar que CI GitHub Actions `ubuntu-latest` tiene Docker disponible sin pasos extras.
0.6. Verificar `tsconfig.json` → `paths: { "@/*": ["./src/*"] }` funciona dentro de `tests/**` (ya funciona hoy por `tests/boundaries.test.ts`).

### Fase 1 — Infra Supabase local

1.1. `supabase init` → commit `supabase/config.toml`. Ajustar a Postgres 15, Realtime on, Storage off (no la usamos aún), Auth magic link on.
1.2. Documentar en CLAUDE.md Gotchas: `supabase start` (primera vez ~2min), `supabase status` URLs/keys, `supabase stop`.
1.3. `.env.example` agrega `DIRECT_URL` + `E2E_TEST_SECRET`.
1.4. Checkpoint: `supabase start` local → `pnpm prisma migrate deploy` → migraciones RLS verdes.

### Fase 2 — Endpoint test-auth + seed E2E

2.1. Implementar `src/app/api/test/sign-in/route.ts`. Triple gate.
2.2. (T) Test unit del endpoint: gate en prod → 404, sin secret → 401, OK → Set-Cookie.
2.3. Implementar `tests/fixtures/e2e-data.ts`.
2.4. Implementar `tests/fixtures/e2e-seed.ts` idempotente. FK-safe wipe: Flag → Reaction → PostRead → Comment → Post → PlaceOpening → Membership → PlaceOwnership → User → Place.
2.5. Correr `pnpm test:e2e:seed` local → verificar en `prisma studio`.

### Fase 3 — Harness RLS + suites directos (TDD)

3.1. Implementar `tests/rls/harness.ts`. `pg.Pool` sobre `DIRECT_URL`, helper `asUser(userId, role?)` abre tx + `SET LOCAL`. Rollback en `afterEach`.
3.2. (T) `tests/rls/helpers-functions.test.ts`. Ver fallar, fixear, ver pasar.
3.3. (T) `tests/rls/post.test.ts` — 18 casos.
3.4. (T) `tests/rls/comment.test.ts` — 12 casos.
3.5. (T) `tests/rls/reaction.test.ts` — 8 casos.
3.6. (T) `tests/rls/flag.test.ts` — 14 casos.
3.7. (T) `tests/rls/post-read.test.ts` — 6 casos.
3.8. (T) `tests/rls/place-opening.test.ts` — 5 casos.
3.9. Checkpoint: `pnpm test:rls` verde (63 casos). Policy bug descubierto → fix en migración nueva `20260425_rls_hotfix`, no en histórica.

### Fase 4 — E2E Playwright

4.1. Implementar `tests/global-setup.ts` (reset + seed + login de 6 roles + persist storageState).
4.2. Actualizar `playwright.config.ts` con `globalSetup` + defaults.
4.3. Implementar `tests/helpers/playwright-auth.ts` y `tests/helpers/subdomain.ts`.
4.4. Mover smokes existentes a `tests/e2e/smoke/`.
4.5. `tests/e2e/flows/post-crud.spec.ts`.
4.6. `tests/e2e/flows/comment-reactions.spec.ts`.
4.7. `tests/e2e/flows/moderation.spec.ts`.
4.8. `tests/e2e/flows/invite-accept.spec.ts` (usa `FakeMailer` para capturar URL).
4.9. `tests/e2e/flows/hours-gate.spec.ts`.
4.10. `tests/e2e/flows/admin-inline.spec.ts`.
4.11. Checkpoint: `pnpm test:e2e` verde local.

### Fase 5 — CI upgrade

5.1. Reescribir job `e2e` en `.github/workflows/ci.yml` con Supabase CLI.
5.2. `supabase status -o env >> $GITHUB_ENV`.
5.3. Step `pnpm test:rls` después de `pnpm test:e2e`.
5.4. `supabase stop` en `if: always()`.
5.5. Secret `E2E_TEST_SECRET` en GitHub Actions.
5.6. PR feature branch → CI verde end-to-end.

### Fase 6 — Docs + cierre

6.1. ADR `docs/decisions/2026-04-21-e2e-rls-testing.md`.
6.2. `docs/roadmap.md` C.H → ✅ con fecha.
6.3. `docs/stack.md` fila Testing.
6.4. `docs/features/discussions/spec.md` § Cobertura de tests.
6.5. `CLAUDE.md` Gotchas (3 bullets nuevos).
6.6. Commit final.

## Verificación

### Automatizada

- `pnpm ci` verde (sin regresiones unit/typecheck/lint/build).
- `pnpm test:rls` verde — 63 casos cubriendo las 16 policies + 2 helper functions.
- `pnpm test:e2e` verde local — ~35 flows × 2 browsers.
- CI GitHub Actions verde — ambos jobs (`quality` + `e2e`).

### Manual (golden path)

1. Developer nuevo: `pnpm install && pnpm supabase:start`.
2. Copia values de `supabase status` a `.env.local`.
3. `pnpm prisma migrate deploy && pnpm test:e2e:seed`.
4. `pnpm test:rls` → verde.
5. `pnpm test:e2e` → verde.
6. `pnpm supabase:stop`.

### Matrix de cobertura RLS (objetivo mínimo)

| Tabla                   | active member     | ex-member | admin     | owner | non-member | service role |
| ----------------------- | ----------------- | --------- | --------- | ----- | ---------- | ------------ |
| Post SELECT visible     | ✓                 | ✗         | ✓         | ✓     | ✗          | bypass       |
| Post SELECT hidden      | ✗                 | ✗         | ✓         | ✓     | ✗          | bypass       |
| Post INSERT self        | ✓                 | ✗         | ✓         | ✓     | ✗          | bypass       |
| Post INSERT otro author | ✗                 | ✗         | ✗         | ✗     | ✗          | bypass       |
| Post UPDATE author      | ✓                 | ✗         | ✓         | ✓     | ✗          | bypass       |
| Post UPDATE otro        | ✗                 | ✗         | ✓ (admin) | ✓     | ✗          | bypass       |
| Post DELETE             | ✗                 | ✗         | ✗         | ✗     | ✗          | bypass       |
| Comment × 5 acciones    | idem Post pattern |           |           |       |            |              |
| Reaction × 4 acciones   | idem              |           |           |       |            |              |
| Flag SELECT own         | ✓                 | ✓         | ✓         | ✓     | ✗          | bypass       |
| Flag SELECT todos       | ✗                 | ✗         | ✓         | ✓     | ✗          | bypass       |
| Flag INSERT self        | ✓                 | ✗         | ✓         | ✓     | ✗          | bypass       |
| Flag UPDATE             | ✗                 | ✗         | ✓         | ✓     | ✗          | bypass       |
| PostRead × 2 acciones   | idem              |           |           |       |            |              |
| PlaceOpening SELECT     | ✓                 | ✗         | ✓         | ✓     | ✗          | bypass       |
| PlaceOpening mutate     | ✗                 | ✗         | ✗         | ✗     | ✗          | bypass       |

### Riesgos y mitigaciones

| Riesgo                                                              | Mitigación                                                                                                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `supabase start` lento en CI (+30s)                                 | Aceptado — full-fidelity compensa. Docker layer cache reduce tras primer run.                                                                             |
| RLS test descubre policy bug real                                   | Scope positivo: fix en migración `20260425_rls_hotfix` dentro de C.H. Documentado en ADR.                                                                 |
| Endpoint `/api/test/sign-in` filtra en prod                         | Gate doble (`NODE_ENV === 'production'` → 404; missing header → 404). Test unit valida ambos paths.                                                       |
| CI monta server en `production` por default                         | `NODE_ENV=test` explícito en el job `env:` — gate tests: smoke test "health endpoint responde y /api/test/sign-in responde 404 sin header" corre primero. |
| Seed fixtures se desalinean con schema                              | Seed importa tipos Prisma directo (`Role`, `BillingMode`) — typecheck rompe si schema cambia.                                                             |
| Playwright storageState expira                                      | `globalSetup` corre cada run; se regenera.                                                                                                                |
| Specs se contaminan entre sí                                        | `resetContent(placeId)` por spec file. Dos places en seed permiten aislar en paralelo.                                                                    |
| Edit window 60s tarda demasiado                                     | Helper `backdatePost` manipula `createdAt` en DB — el server ve el post "viejo" sin esperar.                                                              |
| Conexión `pg` fuga entre tests RLS                                  | `pg.Pool` con `max: 4` + release explícito + `pool.end()` en `afterAll`. Rollback por caso.                                                               |
| `SET LOCAL` no aplica en transaction pooler                         | `DIRECT_URL` (session mode, port 54322) explícito en harness — comentado + en CLAUDE.md.                                                                  |
| Supabase local diverge de prod                                      | Pinear versión CLI en CI; ADR documenta la versión. Upgrade pasivo deshabilitado.                                                                         |
| Supabase redirect URLs no matchean `lvh.me:3000`                    | `supabase/config.toml [auth] site_url + additional_redirect_urls` incluyen `http://lvh.me:3000` y wildcards.                                              |
| Tests paralelos pelean por fixture                                  | `globalSetup` corre una vez; writes usan IDs propios creados en el spec, no sobre fixtures compartidos.                                                   |
| Mobile Safari flaky                                                 | Si un spec falla solo en mobile-safari, `test.describe.configure({ mode: 'serial' })` — evitar global flake-fix. Validación temprana en smoke.            |
| Docker Desktop no instalado en dev local                            | Documentado en CLAUDE.md como prereq. Error mensaje explícito si `supabase start` falla.                                                                  |
| `supabase status --output env` syntax no existe en versión pinneada | Fase 0.3 verifica. Fallback: `--output json                                                                                                               | jq -r '...'`. |

## Fuera de C.H (agendado)

- **E2E de Realtime presencia** — requiere 2 browser contexts coordinados — C.I o sub-fase.
- **E2E de billing/Stripe Connect** — Fase 3.
- **Accesibilidad automática (axe-core)** — pasada separada post-Fase 5.
- **Load testing / k6** — post-MVP.
- **E2E de eventos** — Fase 6.
- **RLS tests sobre `realtime.messages`** — se cubre con E2E de Realtime cuando exista.

## Archivos críticos a consultar durante implementación

- `prisma/migrations/20260422000100_discussions_rls/migration.sql` — 6 tablas × 16 policies. Fuente de verdad de la matriz RLS.
- `prisma/migrations/20260424000000_realtime_discussions_presence/migration.sql` — policy sobre `realtime.messages` (gap documentado, no testeado).
- `src/app/login/dev-actions.ts` — patrón para `POST /api/test/sign-in`.
- `src/shared/lib/supabase/admin.ts` — admin client con service role.
- `src/shared/lib/supabase/cookie-domain.ts` — cookies cross-subdomain.
- `playwright.config.ts` + `tests/e2e/auth.spec.ts` — patrones Playwright existentes.
- `docs/ontologia/conversaciones.md` § 7 — matriz canónica de permisos.
- `docs/decisions/2026-04-21-prisma-pgbouncer-flag.md` — racional `DATABASE_URL` vs `DIRECT_URL`.
- `CLAUDE.md` § Gotchas — base donde se agregan 3 nuevos.

## Post-C.H

Fase 5 cerrada completa. Siguientes fases candidatas (orden a definir con user):

- **Fase 6 — Eventos** (foro maduro, eventos integran threads auto-generados).
- **Fase 3 — Billing** (Stripe Connect; gating por plan; crucial monetización pero puede esperar si foco es PMF).
- **Fase 7 — Portada y zonas**, **Fase 8 — Landing** (UI; dependen de foro + eventos + billing estables).
- **Fase 4 — Feature flags** (gate rollout progresivo; habilita Fase 3).
