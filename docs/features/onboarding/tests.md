# Onboarding · mandato de tests (TDD)

Mandato y casos críticos. **No** diseña los tests en detalle (eso es trabajo de cada sesión) — fija qué se prueba primero, qué es bloqueante y la estrategia de DB de test.

## Mandato

- **TDD obligatorio en el core** (`CLAUDE.md`): tests primero → ver fallar → implementar → ver pasar. Sin excepciones en el core (saga, RLS, invariantes, invitación).
- Stack: **Vitest** (unit/integration, jsdom) + **Playwright** (E2E) — `stack.md`.
- Toda sesión cierra con `pnpm test` + `pnpm typecheck` en verde y reporte de archivos+líneas (`CLAUDE.md`).

## Estrategia de DB de test

- **Branch Neon efímero** por corrida de tests de integración/RLS. Neon es Postgres con branching (`stack.md`, ADR-0004 §Consecuencias: branching "útil para entornos efímeros de test/preview"). Se crea un branch desde `production`/un branch base, se corren las migraciones Drizzle, se ejecutan los tests, se destruye el branch. No se testea contra prod.
- Los tests de RLS deben correr **bajo el rol Postgres custom no-admin** con los claims inyectados (`set_config('request.jwt.claims', …, true)`), **nunca** bajo `neondb_owner` (que tiene `BYPASSRLS` y haría pasar tests que en runtime fallarían — falso verde peligroso).
- Verificar empíricamente en el branch que `auth.user_id()` existe y lee los claims (README §9.2 / `multi-tenancy.md`).

## Casos críticos (probar primero)

### RLS con rol no-admin + claims inyectados (bloqueante)
- Usuario A no puede `SELECT`/`UPDATE`/`DELETE` filas de un place que no ownea (aislamiento entre places).
- Usuario A solo lee/actualiza su propia fila de `app_user` (`auth.user_id() = auth_user_id`).
- Owner tiene CRUD completo sobre las tablas con `place_id` **de su place** (`membership`, `place_ownership`, `invitation`, `place`).
- **`INSERT` inicial del owner pasa la RLS base**: el alta del primer owner (place + place_ownership + membership) no es bloqueada por el predicado que consulta `place_ownership` (orden de inserción / `WITH CHECK`). Caso explícitamente identificado como riesgo (README §9.6).
- Bajo el rol admin todo pasa → ese rol **no** se usa en runtime; el test debe correr bajo el rol custom.

### Saga + falla parcial (bloqueante)
- Happy path: signUp → `app_user`+handle → place+ownership+membership; place servible.
- Falla del paso 1 (signUp) → nada se persiste.
- Falla del paso 3 (place) → cuenta (1–2) queda creada; estado "creá tu place"; no error fatal.
- Idempotencia: reintentar el submit no duplica identidad ni `app_user`; reintentar tras falla del paso 3 no recrea identidad/`app_user`, solo place+ownership+membership.
- `ensureAppUser` idempotente (llamadas repetidas → un solo `app_user`; dedupe por request).

### Invariantes de dominio
- Slug reservado (de `reserved-slugs.ts`) → rechazado.
- Slug duplicado (colisión global) → rechazado.
- Máx 150 miembros por place → el miembro 151 rechazado (estructural).
- Mínimo 1 owner por place (la saga siempre crea la fila `place_ownership`).
- `theme_config` / `opening_hours` validados por Zod (shape canónico de `data-model.md`); guardrail de contraste deriva variante y avisa, nunca persiste par inaccesible.
- `opening_hours` default = 09:00–20:00 todos los días en tz del owner; timezone capturado/derivado.
- Billing: place creado con `OWNER_PAYS`/`ACTIVE`/`trial_ends_at = now()+30d`, `enabled_features=[]`.

### Slug / reservados
- Lista de reservados rechaza `app, www, api, admin, staging, dev, test`.
- Formato de slug compatible con subdominio (minúsculas, alfanumérico+guiones, sin espacios) — validador Zod.
- Chequeo de disponibilidad en vivo no es autoritativo: la verificación dura corre en la saga.

### Invitación + email-match (bloqueante para el diseño cerrado)
- Owner crea/lista/revoca invitaciones de su place (permitido por base owner-only); no puede ver invitaciones de otro place.
- Vía privilegiada de aceptación: token inexistente / expirado (`expires_at`) / ya usado (`accepted_at`) → rechazo.
- Email de la cuenta que acepta **NO** coincide con `invitation.email` → rechazo estricto.
- Éxito: crea `membership` (respeta máx 150 y `UNIQUE(user_id,place_id)`), marca `accepted_at`, corre `ensureAppUser`.
- La RLS owner-only sobre `invitation` **no** rompe: ni la creación-por-owner, ni la aceptación-por-vía-privilegiada (el usuario invitado nunca hace `SELECT` directo sobre `invitation` bajo su rol).
- Alta desde invitación crea cuenta + `membership` **sin** crear place.

### LLM propose-only
- Parser Zod rechaza salida malformada del LLM.
- La salida nunca incluye horario (ADR-0007).
- Nada se persiste sin confirmación humana (propose-only); guardrail de contraste aplicado también a la paleta propuesta por el LLM.

### Routing host-based (S3)
- Middleware rutea apex/`{slug}.`/`app.` a la zona correcta; landing intacta bajo `(marketing)`.
- Slug inexistente → 404.
- URLs públicas = subdominio (sin `placeSlug` en el path).

## Qué NO se testea en esta tanda

- Gate de horario (post-S1; cuando se construya, cross-check con `conversaciones.md`).
- Cobro real / paywall (post-S1).
- Settings del place (post-S1).
- Uploader de avatar/logo (Storage TBD).
</content>
