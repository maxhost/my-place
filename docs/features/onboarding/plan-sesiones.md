# Onboarding · plan de sesiones

Plan de implementación de la tanda de registro (auth + creación de place). **Reescrito 2026-05-17 para el modelo D** (ADR-0012: creación vía función `SECURITY DEFINER`, INSERT directo denegado por RLS). Reemplaza el plan previo, que asumía `WITH CHECK` self-only por-RLS (superseded por ADR-0012 §1 — dejaba escalación de ownership, verificado empíricamente).

> **Ejecución (decidido 2026-05-17):** secuencial, un solo hilo, **sin agentes en paralelo**. El núcleo auth/RLS/creación (S2–S6) es cadena de dependencias dura + estado compartido (un branch Neon, migraciones seriales); paralelizar ahí cambia corrección por velocidad. Hojas tardías (S7/S10) podrían paralelizarse a futuro; por ahora también en serie.

## Disciplina de trabajo (obligatoria, toda sesión)

- **Una sesión = una responsabilidad.** ≤5 archivos núcleo, no mezclar capas (backend/frontend/routing en sesiones separadas). Si una sesión excede esto → subdividir antes de seguir (`CLAUDE.md`).
- **Commit ANTES de empezar cada sesión.** Punto de rollback: si la sesión sale mal, `git reset` al commit previo (el cierre verde de la anterior).
- **`/compact` ANTES de pasar a la siguiente** sesión → ventana de contexto libre. Cada sesión entra entera en una ventana.
- **TDD obligatorio en el core** (`CLAUDE.md`): test primero → ver fallar → implementar → ver pasar. Casos en `tests.md`.
- **Cierre de sesión:** `pnpm test` + `pnpm typecheck` en verde, reporte de archivos+líneas tocados, doc actualizada si cambió una decisión. Recién ahí se commitea y se compacta.
- **Sin código de auth/RLS bajo el rol admin.** Tests de RLS/funciones corren bajo `app_system`, nunca `neondb_owner` (falso verde por `BYPASSRLS`).
- **Verificación browser/cookies/subdominios/custom-domain = preview de Vercel** (dominio real + dominios de prueba), NO localhost (gotcha `__Secure-`). Tests de lógica/RLS = Vitest local contra branch `test` de Neon. Sin mkcert.
- **Decisión arquitectónica nueva → ADR antes de implementar** (`CLAUDE.md`). El modelo D ya está cerrado en **ADR-0012**; cualquier desvío de él pausa y consulta.

## Branches Neon (decidido)

`production` (intocable) · `dev` (una; solo schema consolidado; ahí se escriben migraciones) · `test` (una; se resetea/re-migra entre corridas). dev→prod = aplicar los **mismos archivos de migración** Drizzle a `production` (no se mueven branches).

## Mapa de sesiones y dependencias (modelo D)

```
S0✅─> S1✅─> S2✅ RLS owner-only+INSERT-deny ─> S3✅ fn create_place ─┐
                          │                                  ├─> S5a✅ → S5b Saga ┬─> S8 Wizard ─> S9 Vía "Acceso"
                          └─> S4 Auth wiring ─────────────────┤                  │
                                                              └─> S6 Inv fn      └─> S10 LLM
              S1 ─> S7 Routing host-based ───────────────────────────────────────┘ (S5b para servir place real)
```

Diferido a sesión propia POSTERIOR (no en esta tanda): UI `/invite/{token}`, directorio, gate de horario, `/settings` + gate de email verificado (ADR-0005 §9).

---

## S0 — Harness de tests + entorno (prerequisito) ✅ HECHA (2026-05-17)

**Resultado:** branches Neon `dev`(`br-icy-river-apv86ai9`)/`test`(`br-withered-darkness-apz87zyz`); rol `app_system` (`NOBYPASSRLS`,`LOGIN`) + schema `app` + `app.current_user_id()` en ambas + default privileges; deps (drizzle-orm/kit, @neondatabase/serverless, jose, vitest, ws, dotenv); `vitest.config.ts`/`vitest.setup.ts`/`drizzle.config.ts`; `.env.local` (gitignored); harness `src/db/__tests__/harness.test.ts` (3 tests, patrón runtime: Pool WebSocket + tx + `set_config` local) — **`pnpm test` 3/3 y `pnpm typecheck` verdes**. Password `app_system` dev/test es de desarrollo (rotar el de prod fuera de banda antes del cutover).

## S1 — Schema `public` + migraciones ✅ HECHA (2026-05-17)

**Resultado:** schema Drizzle `src/db/schema/` (6 tablas + 2 enums; `id TEXT` default `(gen_random_uuid())::text`; shapes JSON tipados en `json-shapes.ts`) == `data-model.md`. `src/shared/config/reserved-slugs.ts`. Migración `0000_youthful_hydra.sql` (drizzle-kit) con `app.current_user_id()` (ADR-0011) versionada al frente + `GRANT … TO app_system` por tabla al final — todo idempotente. Aplicada a `dev` y `test`; re-migrate de `test` = no-op. Alias `@/*` en `vitest.config.ts`. **`pnpm test` 16/16 y `pnpm typecheck` verdes.** Gotcha registrado: el driver Neon no parsea arrays uniformemente (`docs/gotchas/neon-serverless-array-parsing.md`).

## S2 — RLS owner-only + INSERT denegado (backend, seguridad — núcleo crítico) ✅ HECHA (2026-05-17)

**Resultado:** policies por-operación de ADR-0010 refinadas por ADR-0012, expresadas en Drizzle (`pgRole('app_system').existing()` + `pgPolicy` por tabla, `src/db/schema/index.ts`): `au_self` (`app_user` `FOR ALL` self-only, incluye su INSERT), `po_sel/upd/del` (`place_ownership` recursion-safe vía `app_user`, **nunca** `place_ownership`), `place_sel/upd/del` y `membership_sel/upd/del` (owner-only vía `place_ownership`), `invitation_all` y `place_domain_all` (`FOR ALL` owner-only). Migración `0001_round_forge.sql` (drizzle-kit generate; `.existing()` evitó `CREATE ROLE`) + `REVOKE INSERT ON place, place_ownership, membership FROM app_system` versionado a mano (defense-in-depth, ADR-0012 §1; precedente: GRANTs de 0000). Aplicada a `dev` y `test`; re-migrate de `test` = no-op. Helper de RLS `inRlsTx` en `db-test-pool.ts` (GRANT efímero intra-tx + `SET ROLE`/`RESET ROLE` + claims conmutables + `SAVEPOINT` para negativos, todo ROLLBACK — patrón canónico documentado en `tests.md`, reusable S3/S6). **Diagnose-before-implement:** el diseño completo (aislamiento, recursion-safe, INSERT-deny, el hueco de escalación cerrado) se verificó empíricamente sobre el branch `test` con el rol real `app_system` **antes** de escribir la migración. `tests.md` actualizado (bullet del helper). **`pnpm test` 25/25, `pnpm typecheck` y `pnpm lint` verdes.** Archivos: `src/db/schema/index.ts` (+policies/role/`ownerOnly`, ~líneas 1-235), `src/db/__tests__/db-test-pool.ts` (+`inRlsTx`/`endRlsAdminPool`, ~líneas 14-110), `src/db/__tests__/rls.test.ts` (nuevo, 9 tests), `src/db/migrations/0001_round_forge.sql` (nuevo), `docs/features/onboarding/tests.md` (bullet helper).

## S3 — Función `app.create_place` `SECURITY DEFINER` + grants (backend, seguridad/dominio) ✅ HECHA (2026-05-17)

**Responsabilidad:** la única vía de creación (ADR-0012 §3). Objeto sensible — TDD estricto.

**Resultado:** función `app.create_place(p_slug,p_name,p_description,p_theme_config jsonb,p_opening_hours jsonb) RETURNS text` escrita a mano en migración `0002_create_place_fn.sql` (`LANGUAGE plpgsql SECURITY DEFINER`, dueño `neondb_owner`, `SET search_path = public, pg_temp`, `REVOKE EXECUTE … FROM PUBLIC` + `GRANT EXECUTE … TO app_system`; `CREATE OR REPLACE` + grants/revoke idempotentes). Caller desde `app.current_user_id()` (no parámetro), `place_id` generado por la DB, billing/trial deterministas (`OWNER_PAYS`/`ACTIVE`/`now()+30d`/`enabled_features=[]`), 3 INSERT atómicos. Drizzle no modela `SECURITY DEFINER` → migración sin diff de schema, registrada a mano en `meta/_journal.json` (idx 2) + `meta/0002_snapshot.json` encadenado off 0001 (`prevId`=id de 0001). **Diagnose-before-implement:** se verificó empíricamente sobre el branch `test` que dentro del DEFINER (dueño `neondb_owner`, BYPASSRLS) `app.current_user_id()` lee el GUC tx-local del **caller** `app_system` (el cambio de privilegio NO sombrea el GUC: ownership+membership apuntan al `app_user` del caller; no-claim→`28000`, app_user inexistente→`P0002`; `EXECUTE` app_system sí / PUBLIC no) **antes** de escribir la migración — premisa del cierre confirmada. Aplicada a `dev` y `test`; re-migrate de `test` = no-op (journal-tracked). `tests.md` actualizado. **`pnpm test` 31/31, `pnpm typecheck` y `pnpm lint` verdes.** Archivos: `src/db/migrations/0002_create_place_fn.sql` (nuevo), `src/db/migrations/meta/_journal.json` (+idx 2), `src/db/migrations/meta/0002_snapshot.json` (nuevo), `src/db/__tests__/create-place.test.ts` (nuevo, 6 tests), `docs/features/onboarding/tests.md`.

## S3.5 — Upgrade Next 15 → 16 (prerequisito de S4) ✅ HECHA (2026-05-18)

**Responsabilidad:** desbloquear S4. Decisión de stack, no de auth → sesión + ADR propias (`CLAUDE.md` "una sesión = una responsabilidad").

**Resultado:** al diagnosticar S4 se halló bloqueo duro (evidencia npm): `@neondatabase/auth` (SDK que S4 cablea) declara `peerDependencies.next` = `>=16.0.0` en **todas** sus versiones publicadas; el repo estaba pineado a Next 15.5.18. Decidido en **ADR-0013**. Ejecutado: `next` 15.5.18→**16.2.6** + `eslint-config-next`→16.2.6 (React 19.1.0 / next-intl 4.12 / bundle-analyzer ya compatibles, sin tocar); `src/middleware.ts`→`src/proxy.ts` (Next 16 renombra el archivo de middleware; `createMiddleware(routing)`+matcher intactos); `.nvmrc` `22` + `engines >=22.0.0` (cierra el TBD de Node de `stack.md`); `eslint.config.mjs` migrado de `FlatCompat`/`compat.extends` (legacy eslintrc, rompía con v16 "circular structure") a flat config nativo (`eslint-config-next/core-web-vitals` + `/typescript` spreadeados) → `@eslint/eslintrc` eliminado (dep huérfana). **Cierre verde: `pnpm build` (landing intacta, 19 páginas/4 locales, `Proxy (Middleware)` reconocido), `pnpm typecheck`, `pnpm lint`, `pnpm test` 31/31** (un timeout transitorio de cold-connect del WebSocket de Neon en una corrida; verde determinista al re-correr — Next 16 no toca la capa DB). `stack.md` actualizado (Next 16 + Node fijado). Archivos: `package.json`, `eslint.config.mjs`, `src/proxy.ts` (ex `middleware.ts`), `.nvmrc` (nuevo), `docs/decisions/0013-upgrade-next-16.md` (nuevo), `docs/decisions/README.md`, `docs/stack.md`.

## S4 — Auth wiring (backend/infra)

**Responsabilidad:** Neon Auth ↔ Postgres (identidad → claims → RLS). **Prerequisito:** S3.5 (Next 16, ADR-0013) — el SDK `@neondatabase/auth` lo exige. **Dividida en S4a/S4b** (regla dura `CLAUDE.md` "una sesión = una responsabilidad / >5 archivos"; decisión del owner 2026-05-18): S4a = core DB/claims/RLS + `ensureAppUser` (TDD puro, contra `test`, sin Neon Auth vivo); S4b = wiring del SDK + route handler + test-guard cookie + env + reconciliación de doc.

### S4a — Core DB/claims/RLS + `ensureAppUser` ✅ HECHA (2026-05-18)

**Resultado.** Diagnóstico empírico del SDK instalado (`@neondatabase/auth@0.4.1-beta`, no asumido): API server canónica `createNeonAuth(...)` de `@neondatabase/auth/next/server`; el JWT se obtiene con **`auth.getAccessToken()`** (endpoint `get-access-token`), **no** `getSession().access_token` como dice hoy `multi-tenancy.md §121`/`stack.md §35` — es el "TBD de implementación de método de token" que ADR-0006 §Consecuencias dejó abierto (no desviación arquitectónica); su reconciliación de doc va en S4b. El catch-all debe ser `[...path]` (lo exige el `Params={path:string[]}` del handler). Implementado con **TDD** (rojo→verde): `src/db/client.ts` (Pool `neon-serverless`, rol `app_system` vía `DATABASE_URL`, `ws`); `src/shared/lib/jwt.ts` (`verifyAccessToken` jose+JWKS, resolver remoto **perezoso** → fail-closed real ante token malformado sin tocar red/env, JWKS inyectable para tests); `src/shared/lib/db.ts` (`getAuthenticatedDb`: verifica **antes** de abrir tx → tx interactiva `app_system` → `set_config('request.jwt.claims', <claims completos>, true)` tx-local → `SqlExecutor` parametrizado; SQL a mano para seams de seguridad = misma convención que las funciones `SECURITY DEFINER`, ADR-0012; Drizzle sigue SoT de schema/RLS); `src/shared/lib/ensure-app-user.ts` (upsert idempotente `ON CONFLICT (auth_user_id) DO NOTHING`, handle random 128-bit ADR-0002, sujeto a `au_self`, dedupe `React.cache`). Helper aditivo `asRawClaims` en `db-test-pool.ts` (S2/S3 intactos). **Diagnose-before-fix:** timeouts espurios de 5000ms en tests S2/S3 al sumar 3 archivos en paralelo = cold-connect real del branch `test` (scale-to-zero), no regresión ni leak de S4a → `vitest.config.ts` `testTimeout/hookTimeout` a 30s (sobre de latencia real, no flakiness tapada). **Cierre verde determinista:** `pnpm build` (landing intacta, `Proxy (Middleware)`), `pnpm typecheck`, `pnpm lint`, `pnpm test` 42/42. Archivos: `src/db/client.ts` (nuevo), `src/shared/lib/{jwt,db,ensure-app-user}.ts` (nuevos), `src/shared/lib/__tests__/{jwt,auth-db,ensure-app-user}.test.ts` (nuevos), `src/db/__tests__/db-test-pool.ts`, `vitest.config.ts`.

### S4b — Wiring Neon Auth SDK + route handler + test-guard cookie ✅ HECHA (2026-05-18)

**Resultado.** Wiring del SDK con TDD (rojo→verde) sobre la parte determinística.

- **Diagnose-before-fix (resolución de seam):** el test rojo reveló que `@neondatabase/auth/next/server` arrastra `next/headers` → importarlo en vitest/node revienta. No se mockeó `next/headers` (frágil); se partió en el seam correcto: `src/shared/lib/auth-config.ts` (PURO: env→config validada + test-guard del `Domain` apex, sin importar el runtime del SDK → vitest-testeable) y `src/shared/lib/auth.ts` (adapter del SDK: `createNeonAuth` + `getAuth()`/`getAuthHandler()` singletons perezosos). El adapter no es vitest-testeable (su correctitud es tipo/build + preview Vercel); el invariante de seguridad (cookie apex + validación de env) SÍ está 100% TDD-cubierto en `auth-config`. No es violación de "TDD en el core": el core acá es el guard, no el glue del SDK.
- **Test-guard apex (`auth.test.ts`, 11 casos):** `cookies.domain` se deriva de `NEXT_PUBLIC_APP_DOMAIN` con punto líder (`.place.community`) — sin punto sería host-only y la sesión no cruzaría subdominios (rota auth en silencio entre sitio público y cada place); el test falla si no empieza con `.`. Más: rechazo de `NEON_AUTH_BASE_URL` faltante/no-URL, secret faltante/<32, `NEXT_PUBLIC_APP_DOMAIN` faltante/no-registrable. No se necesitó env var nueva de dominio (se deriva del apex ya existente).
- **Route handler** `src/app/api/auth/[...path]/route.ts`: wrappers perezosos por verbo (GET/POST/PUT/DELETE/PATCH) delegando a `getAuthHandler()` → `next build` NO depende de la env de Neon Auth (env = preocupación de runtime; build verde, ruta `ƒ /api/auth/[...path]`, landing intacta). Catch-all `[...path]` (el `[...all]` del JSDoc del SDK contradice su propio tipo `Params={path:string[]}`).
- **`.env.local`** (gitignored, nunca git): `NEON_AUTH_BASE_URL`/`NEON_AUTH_JWKS_URL` (valores del diagnóstico MCP 2026-05-16, difieren por branch — re-confirmar con `get_neon_auth_config` si cambia; MCP token expirado en esta sesión, no bloqueante: build/test/typecheck no los ejercen, verificación viva → preview Vercel) + `NEON_AUTH_COOKIE_SECRET` dev generado (prod rotado out-of-band antes del cutover).
- **Reconciliación de doc** (cierra el TBD impl de ADR-0006, no cambio arquitectónico): `multi-tenancy.md §121` y `stack.md §35` `getSession().access_token` → `auth.getAccessToken()` (endpoint `get-access-token`, verificado contra `@neondatabase/auth@0.4.1-beta` 2026-05-18). El SDK además no exporta `NeonAuthConfig` → se deriva de `Parameters<typeof createNeonAuth>[0]`.
- **Verificación cookie/cross-subdomain viva → preview Vercel** (no localhost — gotcha `__Secure-` necesita HTTPS).
- **Cierre verde determinista:** `pnpm typecheck`, `pnpm lint`, `pnpm test` 53/53, `pnpm build` (landing intacta + `ƒ /api/auth/[...path]` + `Proxy (Middleware)`). Archivos: `src/shared/lib/auth-config.ts` (nuevo), `src/shared/lib/auth.ts` (nuevo), `src/app/api/auth/[...path]/route.ts` (nuevo), `src/shared/lib/__tests__/auth.test.ts` (nuevo), `docs/multi-tenancy.md`, `docs/stack.md`. (`.env.local` actualizado, no versionado.)

## S5 — Saga de creación de place: dos modos (backend/dominio)

**Responsabilidad:** el Server Action de creación, **dos modos** (ADR-0008), cableado a `app.create_place` (ADR-0012 §4). **Dividida en S5a/S5b** (regla dura `CLAUDE.md` "una sesión = una responsabilidad / >5 archivos núcleo": S5 cruza dominio puro + orquestación cross-system y excede 5 archivos; decisión del owner 2026-05-18, mismo precedente que el split de S4): S5a = dominio puro (Zod/slug/contraste/defaults, 100% TDD, sin SDK ni DB viva); S5b = saga de orquestación (dos modos, two-tx, slice + puerto cross-system).

> **No es ADR nueva.** Todo sigue dentro de ADR-0005 §2/§4 (saga ordenada, falla parcial controlada), ADR-0008 (dos modos) y ADR-0012 §3/§4 (la tx de `public` = `SELECT app.create_place(...)`, 3 inserts atómicos dentro de la función). Los 3 puntos no triviales abajo son **diagnose-before-implement / cumplimiento**, no desvíos.

### S5a — Dominio puro (backend/dominio, TDD estricto) ✅ HECHA (2026-05-18)

**Resultado.** TDD estricto (rojo→verde): 3 archivos de test escritos primero, verificados fallando (módulos ausentes), luego implementación. **Zod agregado como dependencia** (`zod@4.4.3`) — ya canónico en `stack.md`/`CLAUDE.md` ("Zod para todo input externo"), no estaba instalado; no es desvío arquitectónico. **Guardrail de contraste = `src/shared/lib/contrast.ts`** (puro, sin red ni DOM, reusable por S8/S10): luminancia relativa + razón de contraste WCAG simétrica, umbral AA texto normal 4.5:1 (mismo que la landing); `applyContrastGuardrail` ajusta **`ink`** sobre `bg` (jamás toca `bg`, el lienzo del owner) y deriva **`accentStrong`** (no se persiste, ADR-0005 §7), reportando cada ajuste — NUNCA lanza ni bloquea aun con par patológico (mejor esfuerzo al extremo de mayor contraste, ADR-0005 §8). La landing deriva `--accent-strong` a mano en CSS (`globals.css`), no como TS reutilizable; importar de `features/landing` está prohibido → versión pura propia, no duplicación. **Slice de onboarding** `src/features/onboarding/domain/`: `schema.ts` (Zod — slug formato label-DNS 3–63 + reservados vía `@/shared/config/reserved-slugs`, paleta hex 3/6→`#rrggbb`, `openingHours` con tz IANA validada por `Intl` + rangos `HH:MM` open<close + los 7 días obligatorios, `createPlaceInput` con name 1–80 / description ≤500→`undefined` si vacía); `defaults.ts` (`PAPEL_PALETTE` = valores de marca de la landing, `defaultOpeningHours(tz)` 09–20 los 7 días, ADR-0007); `build-place.ts` (`buildPlaceCreation`: valida→defaults→guardrail→args canónicos de `app.create_place`; `OnboardingDomainError` mapea `ZodError`, nunca filtra el crudo). La unicidad de slug NO se valida acá — frontera dura = `UNIQUE` de S1 vía S5b. **Cierre verde determinista:** `pnpm test` 93/93, `pnpm typecheck`, `pnpm lint` (0 warnings), `pnpm build` (landing intacta + `ƒ /api/auth/[...path]` + `Proxy (Middleware)`). Archivos: `src/shared/lib/contrast.ts` (nuevo), `src/shared/lib/__tests__/contrast.test.ts` (nuevo, 13 tests), `src/features/onboarding/domain/{schema,defaults,build-place}.ts` (nuevos), `src/features/onboarding/domain/__tests__/{schema,build-place}.test.ts` (nuevos, 27 tests), `package.json`/`pnpm-lock.yaml` (+zod).

**Responsabilidad:** toda la lógica determinística de la saga, sin SDK ni DB viva → 100% unit-testeable en Vitest.

- Zod del payload; `slug` formato subdominio + `reserved-slugs` (lista estática/UX, no frontera de seguridad — la dura es el `UNIQUE` de S1; explícito, no es gap).
- **Guardrail de contraste = módulo puro nuevo en `shared/`** (ADR-0005 §8: deriva variante WCAG que cumpla + avisa qué ajustó, nunca persiste par inaccesible). La derivación de la landing vive en CSS (`globals.css`), no como función TS reutilizable → S5a escribe la suya pura (no es duplicación ni toca la landing; importar de `features/landing` está prohibido por el paradigma).
- `theme_config` (paleta acotada, default Papel — shapes en `json-shapes.ts`); `opening_hours` default 09–20 todos los días en tz del owner (tz capturado/derivado); mapeo de errores de dominio.
- **TDD (`tests.md` § Invariantes + Slug/reservados):** Zod rechaza payload malformado; reserved-slug y formato de slug; guardrail deriva variante y avisa (no bloquea, no persiste inaccesible); defaults `opening_hours`/tz; `theme_config` shape canónico.
- **Cierre:** verdes (test + typecheck + lint + build).

### S5b — Saga de orquestación: dos modos, two-tx (backend/dominio)

**Responsabilidad:** el Server Action que orquesta identidad → `app_user` → place, en los dos modos de ADR-0008, consumiendo S5a.

- **Slice nuevo** `src/features/onboarding/` con `public.ts` (paradigma: el Server Action es lógica de feature; `shared/lib` conserva los primitivos de infra `auth`/`db`/`jwt`/`ensure-app-user`).
- Modo place-first (CTA): `signUp` (Neon Auth) → `ensureAppUser` → `SELECT app.create_place(...)`. Modo authed (Acceso→"Crear mi place"): identidad+`app_user` ya existen (`ensureAppUser` idempotente) → `app.create_place(...)`. `signUp`/`ensureAppUser` siguen fuera de la función (cross-system, ADR-0005 §2).
- **Frontera de atomicidad (cumplimiento ADR-0005 §4, NO una sola tx):** `ensureAppUser` commitea en su tx → recién después `app.create_place` en tx propia. Compartir tx haría que el rollback de slug-dup borre el `app_user` → violaría "falla create_place → cuenta+`app_user` queda" (`tests.md` §Saga). Los 3 inserts de `create_place` siguen atómicos *dentro* de la función (ADR-0012 §3).
- **Identidad desde el claim verificado:** `authUserId` de `ensureAppUser` sale de `verifyAccessToken(...).sub` (lo que `app.current_user_id()` lee), NO del `user.id` de la respuesta de signUp — si difieren, `au_self` rechaza el INSERT y `create_place` cae en `P0002`. Invariante con test explícito (`app_user.auth_user_id === claims.sub`).
- **Adquisición del token post-signUp (diagnose-before-implement):** en place-first el usuario está unauth al correr el Server Action; la cookie que setea `signUp` vía `next/headers` **no es re-legible en la misma invocación** → se usa el token de la respuesta de `signUp.email`, **verificado empíricamente contra Neon Auth vivo (preview Vercel), no asumido** (TBD de implementación, como fue `getAccessToken` vs `getSession`). Mismo seam-split que S4b: la orquestación pura se TDD-ea con el borde cross-system (`signUp`/token) inyectado como **puerto**; el wiring vivo del SDK se verifica en preview, no en vitest (arrastra `next/headers` + Neon vivo).
- Mantiene: mapeo `UNIQUE` slug → "slug ocupado"; estado "cuenta sin place" (ADR-0005 §4 / ADR-0008 §4) tras falla; idempotencia del submit.
- **(Hardening opcional, no bloqueante)** evaluar fijar `iss` en `verifyAccessToken` al usarlo desde la saga — defense-in-depth (el JWKS ya es por-instancia → no es hueco abierto); decisión al implementar, sin reabrir S4a si no aporta.
- **TDD (`tests.md` § Saga + Invariantes):** happy path ambos modos (puerto cross-system mockeado); falla signUp → nada; falla create_place (slug dup) → cuenta+`app_user` queda, estado "creá tu place", mapeo `UNIQUE`; atomicidad (los 3 inserts de la función rollbackean juntos; el `app_user` NO); idempotencia del submit; `ensureAppUser` antes de la función; `auth_user_id === sub`; mín 1 owner.
- **Cierre:** verdes; verificación viva place-first (signUp→token→create_place) → preview Vercel (anotado, no localhost).

## S6 — Invitación: función `SECURITY DEFINER` de aceptación (backend/dominio)

**Responsabilidad:** el mecanismo token-link de ADR-0010 §2 (sin UI). RLS owner-only de `invitation` ya está en S2.

- Función a mano en migración `0003`, mismo hardening que S3 (`SECURITY DEFINER`, dueño `neondb_owner`, `SET search_path`, `EXECUTE` solo `app_system`): validar token (existe/no vencido/no usado) + email-match estricto + `ensureAppUser` + `membership` (máx 150, `UNIQUE`) + **test-and-set atómico** de `accepted_at` (`UPDATE … WHERE accepted_at IS NULL RETURNING`). Display (solo-lectura) re-valida; aceptar re-valida en la tx.
- Owner crea/lista/revoca invitaciones por la base owner-only (S2). Alta desde invitación crea cuenta+`membership` **sin** place.
- **TDD (`tests.md` § Invitación):** token inválido/expirado/usado → nada en DB; email mismatch; **doble aceptación simultánea → una gana**; éxito (máx 150, `UNIQUE`); `invitation` no escaneable por el invitado bajo su rol; re-validación display↔submit.
- **Cierre:** verdes.

## S7 — Routing host-based + `(marketing)`/`(app)` (routing/app-shell)

**Responsabilidad:** estructura de rutas y middleware por host (ADR-0005 §10). Sin dominio (delega a saga) ni UI de wizard (S8).

- `src/app/(marketing)/` (apex) y `(app)/` (`{slug}.` place; `app.` inbox). Migrar la landing actual a `(marketing)` sin romperla. `src/middleware.ts` host-based **integrando** i18n. Wildcard DNS/Vercel; Function Region `iad1`. Place servible en `{slug}.place.community` (placeholder hasta S5b).
- **Tests:** rutea apex/subdominio/`app.`; landing intacta; slug inexistente→404; URLs públicas = subdominio (regla de memoria).
- **Cierre:** verdes; build de landing intacto (`cross-env NODE_ENV=production`).

## S8 — Frontend wizard place-first (frontend)

**Responsabilidad:** UI del wizard 3 pasos (CTA). Consume S5b/S7.

- Paso 1 nombre+slug (preview + disponibilidad en vivo, no autoritativa — la dura corre en `app.create_place` vía `UNIQUE`). Paso 2 descripción+paleta acotada (preview, default Papel, guardrail avisa) — sin LLM aún (S10). Paso 3 cuenta + T&C + timezone del browser (fallback fijo). Estado client-side hasta submit. Estado "creá tu place" post-falla.
- **Cierre:** tests de componentes; revisión `producto.md` (cozytech) + continuidad visual con landing; `react-best-practices`.

## S9 — Vía "Acceso": login form + account-first + modo authed (frontend + thin)

**Responsabilidad:** la segunda vía (ADR-0008). Consume S4b/S5b/S8.

- Item "Acceso" en el menú de la landing. Form login/signup account-first → "Crear mi place" (reusa wizard SIN paso de cuenta; saga modo authed) / "Unirme" = solo directorio → **deshabilitado/"próximamente"** (ADR-0009 §2 / ADR-0010 §3). Invitaciones NO desde acá (van por su token-link).
- **Cierre:** tests del form + ramificación; modo authed no re-pide cuenta.

## S10 — Capa LLM propose-only (servicio + isla mínima)

**Responsabilidad:** asistencia LLM (ADR-0005 §5 / ADR-0007). Paralelizable tras S5a.

- Cliente Vercel AI Gateway (`AI_GATEWAY_API_KEY`, modelo chico — fijar acá). Salida Zod `{ palette:{accent,bg,ink}, descriptionDraft }` — **sin horario** (ADR-0007). Propose-only (nada se auto-aplica); guardrail de contraste también sobre la paleta propuesta. Degradación elegante si el LLM falla.
- **Cierre:** parser Zod rechaza malformado; nunca persiste sin confirmación; sin horario; guardrail aplicado.

---

## Análisis de gaps (production-grade — sin parches, sin quick-fix)

Revisión del plan D contra "nada de gaps". Cada ítem es decisión consciente, no omisión:

1. **Escalación de ownership (el gap original).** Cerrado por construcción en S3: `app.create_place` no acepta `place_id` de afuera y toma el caller de `app.current_user_id()`; INSERT directo denegado (S2). No queda superficie de auto-asignación a place ajeno.
2. **Recursión RLS.** Cerrado en S2: `place_ownership` se frasea vía `app_user` (verificado empíricamente). Test bloqueante explícito.
3. **`place_domain` sin RLS.** Cerrado: ADR-0012 lo suma al conjunto owner-only `FOR ALL` (S2). No queda tabla de dominio sin RLS.
4. **Hardening `SECURITY DEFINER`.** Explícito en S3/S6: `SET search_path` fijo, dueño `neondb_owner`, `EXECUTE` solo `app_system` (`REVOKE … PUBLIC`), sin SQL dinámico, identidad de `app.current_user_id()` no de parámetro.
5. **Claims en `SECURITY DEFINER`.** S3 lo verifica empíricamente antes de confiar (premisa del cierre; diagnose-before-infer).
6. **Atomicidad de creación.** Mejorada vs el plan previo: los 3 INSERT son una función atómica en la tx del caller (sin orfanatos en `public`). Falla cross-system (signUp) sigue siendo saga (ADR-0005 §2, intacto). **Frontera explícita (S5b):** `ensureAppUser` y `app.create_place` van en tx **separadas** (no una sola) — es cumplimiento de ADR-0005 §4 ("falla create_place → cuenta+`app_user` queda"), no gap; documentado y TDD-eado en S5b.
7. **Idempotencia / "cuenta sin place".** S5b la maneja a nivel Server Action (sin cambios de ADR-0005 §4 / ADR-0008 §4); `UNIQUE` de slug respalda contra duplicado en reintento.
13. **Token post-signUp en place-first (S5b, no gap).** La cookie de `signUp` no es re-legible en la misma invocación del Server Action → se usa el token de la respuesta de `signUp.email`; TBD de implementación (como `getAccessToken` vs `getSession` en S4b), verificado vivo en preview Vercel, orquestación pura TDD con el borde inyectado. Decisión consciente, no omisión.
14. **Identidad = claim verificado (S5b).** `app_user.auth_user_id` se siembra desde `verifyAccessToken().sub` (lo que RLS lee), no del `user.id` de signUp → sin riesgo de `au_self`/`P0002`. Invariante con test bloqueante.
8. **`reserved-slugs` no es frontera DB.** Decisión consciente: es validación de app/UX (lista estática); la seguridad de slug la da el `UNIQUE` (S1). Documentado en S5a, no es gap.
9. **Source-of-truth de funciones DB.** `app.current_user_id()`/`app.create_place`/aceptación-invitación a mano en migraciones; `src/db/schema/` solo tablas+policies; drizzle-kit no gestiona funciones → sin drift. Explícito en ADR-0012.
10. **Falso verde por admin.** Disciplina + `tests.md`: todo test de RLS/función bajo `app_system`, nunca `neondb_owner`.
11. **Cookie apex / `__Secure-` HTTPS.** S4 test-guard de build + verificación en preview Vercel (gotcha), no localhost.
12. **Fuera de la tanda (consciente, no gap):** `/settings` + gate de email verificado (ADR-0005 §9), UI `/invite/{token}`, directorio, gate de horario → sesiones propias posteriores, ya listadas como diferidas.

Sin gaps abiertos para el alcance "auth + creación de place". Riesgo operativo único pendiente: rotar el password de `app_system` de **producción** fuera de banda antes del cutover (el de dev/test es de desarrollo).

## Resumen

| Sesión | Responsabilidad | Capa | Depende de |
|---|---|---|---|
| S0 ✅ | Harness + entorno (Vitest, branches, rol `app_system`) | infra | — |
| S1 ✅ | Schema `public` + migraciones + reserved-slugs | backend/schema | S0 |
| S2 ✅ | RLS owner-only + INSERT-deny (recursion-safe) | backend/seguridad | S1 |
| S3 ✅ | Función `app.create_place` `SECURITY DEFINER` | backend/seguridad-dominio | S2 |
| S3.5 ✅ | Upgrade Next 15→16 (ADR-0013, prereq de S4) | stack/infra | — |
| S4a ✅ | Core DB/claims/RLS + `ensureAppUser` (TDD, sin Neon Auth vivo) | backend/infra | S2, S3.5 |
| S4b ✅ | Wiring SDK Neon Auth + route handler + test-guard cookie + doc | backend/infra | S4a |
| S5a ✅ | Saga — dominio puro (Zod/slug/contraste/defaults) | backend/dominio | S3, S4b |
| S5b | Saga — orquestación dos modos, two-tx (→ `app.create_place`) | backend/dominio | S5a |
| S6 | Invitación: función `SECURITY DEFINER` de aceptación | backend/dominio | S3 (patrón), S4b |
| S7 | Routing host-based + `(marketing)`/`(app)` | routing/app-shell | S1 (S5b para servir) |
| S8 | Wizard place-first | frontend | S5b, S7 |
| S9 | Vía "Acceso" + modo authed | frontend | S4b, S5b, S8 |
| S10 | Capa LLM propose-only | servicio | S5a |

Diferido a sesión propia posterior: `/settings` + gate email, UI `/invite/{token}`, directorio, gate de horario.

Cada sesión: **commit antes de empezar** → trabajo TDD → **cierre verde** (test+typecheck+reporte) → commit → **`/compact`** → siguiente.
