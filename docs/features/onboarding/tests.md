# Onboarding · mandato de tests (TDD)

Mandato y casos críticos. **No** diseña los tests en detalle (eso es trabajo de cada sesión) — fija qué se prueba primero, qué es bloqueante y la estrategia de DB de test.

## Mandato

- **TDD obligatorio en el core** (`CLAUDE.md`): tests primero → ver fallar → implementar → ver pasar. Sin excepciones en el core (saga, RLS, invariantes, invitación).
- Stack: **Vitest** (unit/integration, jsdom) + **Playwright** (E2E) — `stack.md`.
- Toda sesión cierra con `pnpm test` + `pnpm typecheck` en verde y reporte de archivos+líneas (`CLAUDE.md`).

## Estrategia de DB de test

- **Branch `test` fijo** (no efímero por corrida): modelo de 3 branches decidido (`production`/`dev`/`test`, `plan-sesiones.md`). Conexión como `app_system` vía `DATABASE_URL_TEST`. Aislamiento entre corridas: (a) los tests que **escriben** corren cada uno en una tx con `ROLLBACK` (no se commitea estado), y/o (b) reset del branch `test` re-aplicando migraciones Drizzle a estado limpio antes de la corrida (`db:migrate` contra `DATABASE_URL_TEST_MIGRATE`, rol admin). Nunca se testea contra `production`. El harness S0 ya corre así (tx, sin writes).
- Los tests de RLS deben correr **bajo el rol Postgres custom no-admin** con los claims inyectados (`set_config('request.jwt.claims', …, true)`), **nunca** bajo `neondb_owner` (que tiene `BYPASSRLS` y haría pasar tests que en runtime fallarían — falso verde peligroso).
- **Helper de RLS con claims conmutables (`inRlsTx`, verificado empíricamente 2026-05-17 — S2):** patrón canónico de testeo de RLS = *seed-as-owner → assert-as-restricted → ROLLBACK*, todo en una tx. Mecanismo probado: conexión **admin** (`DATABASE_URL_TEST_MIGRATE`, dueño de las tablas) → `BEGIN` → **`GRANT app_system TO <admin>` efímero dentro de la tx** (GRANT es transaccional → se va con el `ROLLBACK`: cero footprint en prod, cero estado commiteado) → habilita `SET ROLE app_system` / `RESET ROLE`. `seed()` corre con `RESET ROLE` (dueño de la tabla → RLS no aplica; siembra place/ownership/membership que en runtime sólo crearía `app.create_place` — el dueño es `neondb_owner`, idéntico al `DEFINER` de la función, S3). `as(sub)` hace `SET ROLE app_system` + `set_config('request.jwt.claims', …, true)` (conmutable mid-tx). Los casos **negativos** (denegación) van envueltos en `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` (un stmt fallido aborta toda la tx en Postgres). Las aserciones **siempre** corren bajo `app_system`, nunca el rol admin. S3/S6 reusan este helper (no asumir que `app.create_place` existe para sembrar en S2).
- `app.current_user_id()` es función **propia** (ADR-0011), ya verificada empíricamente 2026-05-17. Los tests de RLS asumen que la migración la creó; el caso de test es el **comportamiento** (lee `sub`, NULL sin claim → deniega), no "existe".
- **Introspección de schema/RLS:** el driver `@neondatabase/serverless` **no** devuelve los arrays de Postgres de forma uniforme — `array_agg`/`text[]` vuelve como literal `'{a,b}'` (string), no array JS. Usar `string_agg(col, ',')`+`.split(",")`, nunca `array_agg` esperando un array. Gotcha completo: `docs/gotchas/neon-serverless-array-parsing.md`.

## Casos críticos (probar primero)

### RLS con rol no-admin + claims inyectados (bloqueante, ADR-0010/0012)
- Usuario A no puede `SELECT`/`UPDATE`/`DELETE` filas de un place que no ownea (aislamiento entre places). Cubre `place`, `membership`, `place_ownership`, `invitation`, `place_domain`.
- Usuario A solo lee/actualiza su propia fila de `app_user` (`app.current_user_id() = auth_user_id`).
- Owner tiene SELECT/UPDATE/DELETE completo sobre las tablas con `place_id` **de su place**; owner crea/lista/revoca `invitation` y administra `place_domain` de su place por la base owner-only.
- **Recursion-safe (bloqueante):** la policy de `place_ownership` referencia `app_user`, **nunca** `place_ownership` — un fraseo auto-referencial da `infinite recursion detected` (verificado 2026-05-17). Test: el aislamiento owner-only sobre `place`/`membership` (que sub-consultan `place_ownership`) **no** lanza recursión.
- **INSERT de creación DENEGADO (bloqueante, ADR-0012):** bajo `app_system`, un `INSERT` directo a `place` / `place_ownership` / `membership` es **rechazado** (sin policy de INSERT + `REVOKE INSERT`). No hay vía directa de creación.
- **`app.create_place` (bloqueante, ADR-0012 — verificado empíricamente 2026-05-17, S3):** crea un place fresco y asigna al **caller** (de `app.current_user_id()`, no parámetro) como owner+miembro, atómico; billing/trial deterministas. Sin claim → rechaza (`28000`). `app_user` inexistente → rechaza (`P0002`). **B no puede crear ownership en place ajeno**: la función genera el `place_id`, no acepta uno de afuera → no hay forma de apuntar a un place existente. `EXECUTE` solo `app_system` (no `PUBLIC`). **Premisa de cierre confirmada (diagnose-before-infer):** dentro del `SECURITY DEFINER` (dueño `neondb_owner`, BYPASSRLS) `app.current_user_id()` lee el GUC `request.jwt.claims` tx-local del **caller** (`app_system`) — el cambio de privilegio del DEFINER NO sombrea el GUC (es estado de sesión/tx, role-independent). Tests reusan `inRlsTx` (seed `app_user` como dueño → `as(caller)` → `SELECT app.create_place(...)`).
- `invitation` / `place_domain` INSERT: owner-only por RLS (place+ownership ya existen, sin chicken-egg) — owner SÍ inserta; no-owner NO.
- Bajo el rol admin todo pasa → ese rol **no** se usa en runtime; el test debe correr bajo `app_system` (rol custom), nunca `neondb_owner`.

### Saga + falla parcial (bloqueante, ADR-0005/0008/0012)
- Happy path: signUp → `app_user`+handle → `SELECT app.create_place(...)` (place+ownership+membership atómico); place servible.
- Falla del paso 1 (signUp) → nada se persiste.
- Falla de `app.create_place` (p.ej. slug duplicado) → cuenta (signUp+`app_user`) queda creada; estado "creá tu place"; no error fatal; mapeo de `UNIQUE` violation → "slug ocupado".
- Atomicidad: si `app.create_place` falla a mitad, rollback de los 3 inserts (sin place/ownership/membership huérfanos en `public`).
- Idempotencia del submit: reintentar no duplica identidad ni `app_user`; tras falla de creación no recrea identidad/`app_user`, solo reintenta `app.create_place`.
- `ensureAppUser` idempotente (llamadas repetidas → un solo `app_user`; dedupe por request); corre **antes** de `app.create_place` (la función exige `app_user` del caller).

### Invariantes de dominio
- Slug reservado (de `reserved-slugs.ts`) → rechazado.
- Slug duplicado (colisión global) → rechazado.
- Máx 150 miembros por place → el miembro 151 rechazado (estructural).
- Mínimo 1 owner por place (`app.create_place` siempre crea `place_ownership`+`membership` del caller, atómico).
- `theme_config` / `opening_hours` validados por Zod (shape canónico de `data-model.md`); guardrail de contraste deriva variante y avisa, nunca persiste par inaccesible.
- `opening_hours` default = 09:00–20:00 todos los días en tz del owner; timezone capturado/derivado.
- Billing: place creado con `OWNER_PAYS`/`ACTIVE`/`trial_ends_at = now()+30d`, `enabled_features=[]`.

### Slug / reservados
- Lista de reservados rechaza `app, www, api, admin, staging, dev, test`.
- Formato de slug compatible con subdominio (minúsculas, alfanumérico+guiones, sin espacios) — validador Zod.
- Chequeo de disponibilidad en vivo no es autoritativo: la verificación dura corre en la saga.

### Invitación token-link (bloqueante — ADR-0010)
- Owner crea/lista/revoca invitaciones de su place (base owner-only); no puede ver invitaciones de otro place.
- `invitation` 100% owner-only: bajo el rol `app_system`, un invitado **no** puede `SELECT`/`UPDATE` `invitation` directo (la tabla nunca se escanea por su rol).
- Función `SECURITY DEFINER` (dueño = rol privilegiado; `EXECUTE` solo `app_system`): token inexistente / expirado (`expires_at`) / ya usado (`accepted_at IS NOT NULL`) → rechazo, **nada en la DB**.
- Email de la cuenta que acepta **NO** coincide con `invitation.email` → rechazo estricto.
- **Test-and-set de un solo uso (bloqueante):** **dos aceptaciones simultáneas** del mismo token → exactamente **una** gana; la otra aborta (el `UPDATE … WHERE accepted_at IS NULL RETURNING` no afecta filas). No quedan dos memberships (respaldado por `UNIQUE(user_id,place_id)`).
- Re-validación: token válido al display pero **vencido/usado entre display y submit** → el submit rechaza (se re-valida en la tx).
- Éxito: `ensureAppUser` → `membership` (máx 150, `UNIQUE`) → `accepted_at` seteado atómico.
- Alta desde invitación crea cuenta + `membership` **sin** crear place.
- **S6 implementado (verificado 2026-05-18):** dos funciones `SECURITY DEFINER` (dueño `neondb_owner`, `EXECUTE` solo `app_system`, mismo hardening que S3) en `0003_accept_invitation_fn.sql` — `app.invitation_preview(token)` (solo-lectura, **sin claim**: el token ES la capability, el invitado puede no tener cuenta) y `app.accept_invitation(token)` (atómica, requiere claim; `ensureAppUser` corre app-side **antes**, P0002 si falta). Email-match estricto = `lower(btrim())` (rechaza otra dirección, tolera mayúsculas/espacios). **El test-and-set se unit-testea como PREDICADO determinista** (2ª aceptación secuencial afecta 0 filas + 1 sola membership) — la concurrencia wall-clock real es preview/integración, no Vitest single-tx (mismo precedente que el `UNIQUE` secuencial de S3, `inRlsTx` reutilizado). El wiring app-side (Server Action signup-desde-invitación) + UI `/invite/{token}` quedan diferidos a sesión propia (análogo a S5b sobre S3).

### LLM propose-only
- Parser Zod rechaza salida malformada del LLM.
- La salida nunca incluye horario (ADR-0007).
- Nada se persiste sin confirmación humana (propose-only); guardrail de contraste aplicado también a la paleta propuesta por el LLM.

### Routing host-based (S7)
- Proxy rutea apex/`{slug}.`/`app.` a la zona correcta; landing intacta bajo `(marketing)`.
- Slug inexistente → 404.
- URLs públicas = subdominio (sin `placeSlug` en el path).
- **S7 implementado (verificado 2026-05-18):** clasificación pura en `src/shared/lib/host-routing.ts` (`resolveHost`/`isServiceableSlug`), unit-testeada sin red/DB (`host-routing.test.ts`, 14 casos) — apex/`www`/`localhost`/`*.vercel.app`/desconocido→marketing, `app.`→inbox, otro→place+slug, strip de puerto, `*.localhost` dev. `src/proxy.ts` delega i18n en marketing (integrado) y reescribe a **prefijo estático interno** (`/place/{slug}`, `/inbox`) — Next prohíbe dos segmentos dinámicos distintos en la misma posición aunque haya route groups (`[locale]`↔`[placeSlug]`); el prefijo no aparece en la URL pública (regla URLs=subdominio intacta). "Slug inexistente→404" en S7 = gate **estructural** (la page `notFound()` por reservado/formato vía `isServiceableSlug`); la existencia real por DB (`loadPlaceBySlug`) + streaming del shell son S5b/S8. Landing intacta verificada por `pnpm build` (SSG 4 locales). Custom domains → marketing fallback hasta `place_domain` verificado (feature posterior).

## Qué NO se testea en esta tanda

- Gate de horario (post-S1; cuando se construya, cross-check con `conversaciones.md`).
- Cobro real / paywall (post-S1).
- Settings del place (post-S1).
- Uploader de avatar/logo (Storage TBD).
</content>
