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
                          │                                       ├─> S5 Saga ─┬─> S8 Wizard ─> S9 Vía "Acceso"
                          └─> S4 Auth wiring ──────────────────────┤            │
                                                                   └─> S6 Inv fn└─> S10 LLM
              S1 ─> S7 Routing host-based ──────────────────────────────────────┘ (S5 para servir place real)
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

### S4b — Wiring Neon Auth SDK + route handler + test-guard cookie (pendiente)

- `src/shared/lib/auth.ts`: `createNeonAuth({ baseUrl, cookies:{ domain apex, secret } })` (singleton); route handler first-party `app/api/auth/[...path]/route.ts` = `auth.handler()`.
- Test-guard de build: falla si la cookie de sesión se emite sin `Domain` apex.
- `.env.local`: `NEON_AUTH_BASE_URL`/`NEON_AUTH_JWKS_URL`/`NEON_AUTH_COOKIE_SECRET` (secret dev; prod rotado out-of-band antes del cutover).
- Reconciliación de doc (verificado + fecha; cierra el TBD impl de ADR-0006, no es cambio arquitectónico): `multi-tenancy.md §121` y `stack.md §35` `getSession().access_token` → `auth.getAccessToken()`.
- Verificación cookie/cross-subdomain → preview Vercel (anotado, no localhost — gotcha `__Secure-`).
- **Cierre:** verdes.

## S5 — Saga de creación de place: dos modos (backend/dominio)

**Responsabilidad:** el Server Action de creación, **dos modos** (ADR-0008), cableado a `app.create_place` (ADR-0012 §4).

- Modo place-first (CTA): `signUp` (Neon Auth) → `ensureAppUser` → `SELECT app.create_place(...)`. Modo authed (Acceso→"Crear mi place"): identidad+`app_user` ya existen (`ensureAppUser` idempotente) → `app.create_place(...)`. `signUp`/`ensureAppUser` siguen fuera de la función (cross-system, ADR-0005 §2).
- Server Action mantiene: Zod del payload; slug-format + `reserved-slugs` (lista estática/UX, no frontera de seguridad — explícito, no es gap); guardrail de contraste server-side; `theme_config` (paleta acotada, default Papel); `opening_hours` default 09–20 en tz del owner (tz capturado/derivado); mapeo `UNIQUE` slug → "slug ocupado"; estado "cuenta sin place" (ADR-0005 §4 / ADR-0008 §4) tras falla.
- **TDD (`tests.md` § Saga + Invariantes):** happy path ambos modos; falla signUp → nada; falla create_place (slug dup) → cuenta queda, estado "creá tu place"; atomicidad (rollback de los 3 inserts); idempotencia del submit; `ensureAppUser` antes de la función; invariantes (reserved-slug, slug único, mín 1 owner); Zod; guardrail.
- **Cierre:** verdes.

## S6 — Invitación: función `SECURITY DEFINER` de aceptación (backend/dominio)

**Responsabilidad:** el mecanismo token-link de ADR-0010 §2 (sin UI). RLS owner-only de `invitation` ya está en S2.

- Función a mano en migración `0003`, mismo hardening que S3 (`SECURITY DEFINER`, dueño `neondb_owner`, `SET search_path`, `EXECUTE` solo `app_system`): validar token (existe/no vencido/no usado) + email-match estricto + `ensureAppUser` + `membership` (máx 150, `UNIQUE`) + **test-and-set atómico** de `accepted_at` (`UPDATE … WHERE accepted_at IS NULL RETURNING`). Display (solo-lectura) re-valida; aceptar re-valida en la tx.
- Owner crea/lista/revoca invitaciones por la base owner-only (S2). Alta desde invitación crea cuenta+`membership` **sin** place.
- **TDD (`tests.md` § Invitación):** token inválido/expirado/usado → nada en DB; email mismatch; **doble aceptación simultánea → una gana**; éxito (máx 150, `UNIQUE`); `invitation` no escaneable por el invitado bajo su rol; re-validación display↔submit.
- **Cierre:** verdes.

## S7 — Routing host-based + `(marketing)`/`(app)` (routing/app-shell)

**Responsabilidad:** estructura de rutas y middleware por host (ADR-0005 §10). Sin dominio (delega a saga) ni UI de wizard (S8).

- `src/app/(marketing)/` (apex) y `(app)/` (`{slug}.` place; `app.` inbox). Migrar la landing actual a `(marketing)` sin romperla. `src/middleware.ts` host-based **integrando** i18n. Wildcard DNS/Vercel; Function Region `iad1`. Place servible en `{slug}.place.community` (placeholder hasta S5).
- **Tests:** rutea apex/subdominio/`app.`; landing intacta; slug inexistente→404; URLs públicas = subdominio (regla de memoria).
- **Cierre:** verdes; build de landing intacto (`cross-env NODE_ENV=production`).

## S8 — Frontend wizard place-first (frontend)

**Responsabilidad:** UI del wizard 3 pasos (CTA). Consume S5/S7.

- Paso 1 nombre+slug (preview + disponibilidad en vivo, no autoritativa — la dura corre en `app.create_place` vía `UNIQUE`). Paso 2 descripción+paleta acotada (preview, default Papel, guardrail avisa) — sin LLM aún (S10). Paso 3 cuenta + T&C + timezone del browser (fallback fijo). Estado client-side hasta submit. Estado "creá tu place" post-falla.
- **Cierre:** tests de componentes; revisión `producto.md` (cozytech) + continuidad visual con landing; `react-best-practices`.

## S9 — Vía "Acceso": login form + account-first + modo authed (frontend + thin)

**Responsabilidad:** la segunda vía (ADR-0008). Consume S4/S5/S8.

- Item "Acceso" en el menú de la landing. Form login/signup account-first → "Crear mi place" (reusa wizard SIN paso de cuenta; saga modo authed) / "Unirme" = solo directorio → **deshabilitado/"próximamente"** (ADR-0009 §2 / ADR-0010 §3). Invitaciones NO desde acá (van por su token-link).
- **Cierre:** tests del form + ramificación; modo authed no re-pide cuenta.

## S10 — Capa LLM propose-only (servicio + isla mínima)

**Responsabilidad:** asistencia LLM (ADR-0005 §5 / ADR-0007). Paralelizable tras S5.

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
6. **Atomicidad de creación.** Mejorada vs el plan previo: los 3 INSERT son una función atómica en la tx del caller (sin orfanatos en `public`). Falla cross-system (signUp) sigue siendo saga (ADR-0005 §2, intacto).
7. **Idempotencia / "cuenta sin place".** S5 la maneja a nivel Server Action (sin cambios de ADR-0005 §4 / ADR-0008 §4); `UNIQUE` de slug respalda contra duplicado en reintento.
8. **`reserved-slugs` no es frontera DB.** Decisión consciente: es validación de app/UX (lista estática); la seguridad de slug la da el `UNIQUE` (S1). Documentado en S5, no es gap.
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
| S4b | Wiring SDK Neon Auth + route handler + test-guard cookie + doc | backend/infra | S4a |
| S5 | Saga de creación (dos modos → `app.create_place`) | backend/dominio | S3, S4b |
| S6 | Invitación: función `SECURITY DEFINER` de aceptación | backend/dominio | S3 (patrón), S4b |
| S7 | Routing host-based + `(marketing)`/`(app)` | routing/app-shell | S1 (S5 para servir) |
| S8 | Wizard place-first | frontend | S5, S7 |
| S9 | Vía "Acceso" + modo authed | frontend | S4b, S5, S8 |
| S10 | Capa LLM propose-only | servicio | S5 |

Diferido a sesión propia posterior: `/settings` + gate email, UI `/invite/{token}`, directorio, gate de horario.

Cada sesión: **commit antes de empezar** → trabajo TDD → **cierre verde** (test+typecheck+reporte) → commit → **`/compact`** → siguiente.
