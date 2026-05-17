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
S0✅─> S1✅─> S2 RLS owner-only+INSERT-deny ─> S3 fn create_place ─┐
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

## S2 — RLS owner-only + INSERT denegado (backend, seguridad — núcleo crítico)

**Responsabilidad:** las policies de ADR-0010 refinadas por ADR-0012. Punto que si falla, nada sirve.

- Drizzle: `pgRole('app_system').existing()` + `pgPolicy` por tabla. Migración `0001` (drizzle-kit generate; ENABLE RLS es idempotente, las policies van por journal).
- **`app_user` — `FOR ALL`:** propia fila (USING+WITH CHECK `(select app.current_user_id()) = auth_user_id`).
- **`place_ownership` — SELECT/UPDATE/DELETE:** "esta fila es mía" referenciando **`app_user`, nunca `place_ownership`** (recursion-safe — auto-referencia da `infinite recursion detected`, verificado).
- **`place` / `membership` / `invitation` / `place_domain` — SELECT/UPDATE/DELETE:** owner-only vía `place_ownership` (predicado ADR-0010). `invitation` y `place_domain` además `FOR ALL` owner-only (incluye su INSERT: place+ownership ya existen, sin chicken-egg). `place_domain` entra al conjunto por ADR-0012 (cerrar omisión de enumeración).
- **`place` / `place_ownership` / `membership` — INSERT: sin policy + `REVOKE INSERT` a `app_system`** (denegado por construcción + defense-in-depth). `app_system` conserva SELECT/UPDATE/DELETE.
- Helper de test con **claims conmutables mid-tx** (rollback) en `db-test-pool` (lo precisa S2/S3/S6).
- **TDD (bloqueante, `tests.md` § RLS):** aislamiento cross-place en las 5 tablas; `app_user` propia-fila; recursion-safe (owner-only no lanza recursión); INSERT directo a place/po/membership **rechazado**; `invitation`/`place_domain` INSERT owner-only (owner sí, no-owner no); todo bajo `app_system`, nunca admin; sin-claim deniega.
- **Cierre:** tests RLS verdes; migración aplica limpia e idempotente a `dev`+`test`.

## S3 — Función `app.create_place` `SECURITY DEFINER` + grants (backend, seguridad/dominio)

**Responsabilidad:** la única vía de creación (ADR-0012 §3). Objeto sensible — TDD estricto.

- Función a mano en migración `0002` (Drizzle no modela `SECURITY DEFINER`; precedente `app.current_user_id()`): `LANGUAGE plpgsql SECURITY DEFINER`, dueño `neondb_owner`, **`SET search_path = public, pg_temp`** (anti-hijack), `REVOKE EXECUTE … FROM PUBLIC` + `GRANT EXECUTE … TO app_system`. Idempotente (`CREATE OR REPLACE` + grants idempotentes).
- Firma `app.create_place(p_slug, p_name, p_description, p_theme_config jsonb, p_opening_hours jsonb) RETURNS text`. Caller de `app.current_user_id()` (no parámetro); `place_id` generado por la DB (no se acepta de afuera); billing/trial deterministas (`OWNER_PAYS`/`ACTIVE`/`now()+30d`/`enabled_features=[]`, ADR-0005 §3); 3 INSERT atómicos en la tx del caller.
- **Verificar empíricamente (diagnose-before-infer):** que `app.current_user_id()` dentro de un `SECURITY DEFINER` siga leyendo el GUC tx-local del caller (no lo cambia el cambio de privilegio). Es premisa del cierre.
- **TDD (bloqueante, `tests.md` § RLS):** crea place fresco + caller owner+miembro atómico; sin claim → rechaza; `app_user` inexistente → rechaza; **no acepta `place_id` ajeno** (no hay parámetro → B no puede apuntar a place existente); billing/trial deterministas; slug duplicado → `UNIQUE` violation propaga; `EXECUTE` denegado a `PUBLIC`; corre bajo `app_system`.
- **Cierre:** tests verdes; migración idempotente `dev`+`test`.

## S4 — Auth wiring (backend/infra)

**Responsabilidad:** Neon Auth ↔ Postgres (identidad → claims → RLS).

- `createNeonAuth({ cookies:{ domain apex, secret } })`, route handler first-party `app/api/auth/[...path]`, helper `getAuthenticatedDb`: verifica `session.access_token` con `jose`+JWKS → `set_config('request.jwt.claims', <claims>, true)` (**tx-local obligatorio**) en `db.transaction`, driver `neon-serverless`.
- `ensureAppUser(authUserId)` primitivo idempotente en `shared/lib` (dedupe `React.cache`); INSERT de `app_user` sujeto a su RLS self-only (sin chicken-egg).
- Test-guard de build: falla si la cookie de sesión se emite sin `Domain` apex.
- **TDD:** `ensureAppUser` idempotente; sesión→claims→RLS end-to-end (lógica, contra `test`, reusa S2); test-guard dispara. Verificación cookie/cross-subdomain → preview Vercel (anotado, no localhost — gotcha `__Secure-`).
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
| S2 | RLS owner-only + INSERT-deny (recursion-safe) | backend/seguridad | S1 |
| S3 | Función `app.create_place` `SECURITY DEFINER` | backend/seguridad-dominio | S2 |
| S4 | Auth wiring (Neon Auth↔RLS, `ensureAppUser`) | backend/infra | S2 |
| S5 | Saga de creación (dos modos → `app.create_place`) | backend/dominio | S3, S4 |
| S6 | Invitación: función `SECURITY DEFINER` de aceptación | backend/dominio | S3 (patrón), S4 |
| S7 | Routing host-based + `(marketing)`/`(app)` | routing/app-shell | S1 (S5 para servir) |
| S8 | Wizard place-first | frontend | S5, S7 |
| S9 | Vía "Acceso" + modo authed | frontend | S4, S5, S8 |
| S10 | Capa LLM propose-only | servicio | S5 |

Diferido a sesión propia posterior: `/settings` + gate email, UI `/invite/{token}`, directorio, gate de horario.

Cada sesión: **commit antes de empezar** → trabajo TDD → **cierre verde** (test+typecheck+reporte) → commit → **`/compact`** → siguiente.
