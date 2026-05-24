# `place_ownership` multi-owner V1 — Tests checklist

> _Checklist TDD por sesión. Cada test describe una expectativa observable; el orden refleja el plan de sesiones ([`./plan-sesiones.md`](./plan-sesiones.md)). Convención: `[ ]` pending, `[x]` ejecutado verde._
>
> **Mandato TDD (CLAUDE.md §"Durante la implementación")**: tests primero, verificar que fallan, implementar, verificar que pasan. Sin excepciones en el core. Cada sesión arranca con tests RED, implementa, verifica GREEN. Las 4 funciones DEFINER son código de seguridad — RED→GREEN obligatorio antes de tag.
>
> **Total proyectado nuevo**: ~47 tests vitest distribuidos S1-S5 + verificaciones manuales psql en S1 + S6. Suite objetivo post-S6: baseline + 47.

## Canon "Tests SQL directo vía harness `inRlsTx`"

Heredado del precedente `docs/features/custom-domain-sso/tests.md` §S1. Feature D V1 NO introduce code paths nuevos en `src/` excepto los archivos de schema (regenerated por Drizzle introspect post-migration) — toda la lógica vive en SQL DEFINER, así que los tests son SQL directo contra Neon test branch vía harness `inRlsTx` de `src/db/__tests__/db-test-pool.ts` (seed-as-`neondb_owner`, assert-as-`app_system` con claim del user-bajo-test, ROLLBACK siempre). Los tests inyectan `request.jwt.claims` para simular distintos callers en la misma transacción.

---

## S1 — Migration 0012 + helper DEFINER + refactor RLS

### `src/db/__tests__/rls-place-ownership.test.ts` (nuevo)

**Por qué importa:** el refactor de policies SELF → OWNER-OF-PLACE + REVOKE INSERT/UPDATE/DELETE + helper `app.current_user_owns_place` es la base de toda la feature. Si alguno de los 14 tests falla, el resto de las sesiones (S2-S5) opera sobre superficie quebrada.

**Harness:** `inRlsTx` con seed-as-`neondb_owner` (crear 2 places + 3 users + 3 ownerships) y assert-as-`app_system` con claim inyectado por test.

**LOC budget estimado:** 250-280. Si excede 295 → Plan B documentado en `plan-sesiones.md` S1: split en 2 archivos hermanos (`rls-place-ownership-structural.test.ts` con los 6 tests structural + helper, ~120 LOC; `rls-place-ownership-matrix.test.ts` con los 8 tests RLS matrix + back-fill, ~160 LOC).

**Casos cubiertos (14 total):**

- [ ] Back-fill determinístico: `UPDATE place SET founder_user_id = (SELECT user_id FROM place_ownership WHERE place_id = p.id ORDER BY granted_at ASC LIMIT 1)` asigna `MIN(granted_at).user_id` per place; ejecutar 2× sin cambios.
- [ ] `place.founder_user_id` NOT NULL post-migration: tras back-fill + `ALTER COLUMN SET NOT NULL`, INSERT a `place` sin `founder_user_id` falla con `not_null_violation` (`23502`).
- [ ] `po_sel` owner-of-place: owner-A ve TODAS las filas de ownership de su place (incluyendo las de owner-B co-owner).
- [ ] `po_sel` denial cross-owner: no-owner ve 0 rows del place ajeno (cero leak).
- [ ] `po_sel` cross-place scoping: owner-A de place-1 NO ve filas de ownership de place-2 (donde no es owner).
- [ ] REVOKE INSERT direct denegado: `INSERT INTO place_ownership ...` desde rol `app_system` con claim válido → `permission denied for table place_ownership` (`42501`).
- [ ] REVOKE UPDATE direct denegado: `UPDATE place_ownership SET granted_at = now() WHERE ...` → `permission denied`.
- [ ] REVOKE DELETE direct denegado: `DELETE FROM place_ownership WHERE ...` → `permission denied`.
- [ ] Structural — `pg_policies`: sólo existe `po_sel` para `place_ownership`; `po_upd` y `po_del` NO existen (DROP confirmed).
- [ ] Structural — `pg_proc`: `app.current_user_owns_place(text)` existe con `prosecdef = true` + `proleakproof = false` + `provolatile = 's'` (STABLE).
- [ ] Structural — GRANT/REVOKE: `app.current_user_owns_place(text)` tiene EXECUTE concedido a `app_system`, REVOKED de PUBLIC (`\dp` equivalent via `pg_proc.proacl`).
- [ ] Helper happy: `app.current_user_owns_place(place_a_id)` retorna `true` cuando claim del caller corresponde a owner-A de place-A.
- [ ] Helper denial: `app.current_user_owns_place(place_b_id)` retorna `false` cuando caller no es owner de place-B.
- [ ] Helper anonymous: `app.current_user_owns_place(any_place_id)` con `app.current_user_id() IS NULL` (claim vacío) retorna `false` sin throw (null-safe).

**Verificación manual psql (no en CI, S1 closeout):**

- [ ] `psql -c "SELECT polname FROM pg_policy WHERE polrelid = 'place_ownership'::regclass;"` retorna sólo `po_sel`.
- [ ] `psql -c "\df app.current_user_owns_place"` muestra `Security` = `definer`.
- [ ] `psql -c "SELECT founder_user_id IS NOT NULL AS ok FROM place;"` retorna `t` para todas las filas (back-fill cubrió 100%).
- [ ] Header de la migration 0012 documenta reverse-SQL inline (regrant + drop helper + drop function + restore policies — ver `plan-sesiones.md` §"Reverse SQL manual").

**Total S1: 14 vitest + 4 verificaciones manuales psql.**

---

## S2 — `app.elevate_to_owner` (migration 0013)

### `src/db/__tests__/elevate-to-owner.test.ts` (nuevo)

**Por qué importa:** primer mutador DEFINER del flow. Bug en pre-conditions = co-owners promovidos sin ser miembros, owners duplicados, o caller no-owner promoviendo a alguien (privilege escalation).

**Harness:** `inRlsTx` con seed-as-`neondb_owner` (2 places + 4 users + memberships + 1 ownership inicial: owner-A en place-1).

**Casos cubiertos (8 total):**

- [ ] Happy path: caller = owner-A, target = bob (miembro activo de place-1, no-owner) → INSERT fila `(place_1, bob, now())` en `place_ownership` (assert: SELECT count(*) WHERE place_id = place_1 = 2 post-call).
- [ ] Caller no-owner: caller = carol (sólo miembro de place-1, no owner), target = bob → `P0001 caller is not an owner of this place`.
- [ ] Target no-miembro: caller = owner-A, target = dave (NO tiene membership en place-1) → `P0001 target is not an active member`.
- [ ] Target ya owner: caller = owner-A, target = owner-A mismo (ya tiene ownership) → `P0001 target is already an owner` (duplicate).
- [ ] Target self-promote: caller = owner-A, target = owner-A (ambos son el owner) → tratado como `target is already an owner` (test fija el comportamiento: la función NO trata self como caso especial — la pre-condición `target ya owner` lo cubre). Documentar en spec si distinto.
- [ ] Caller sin sesión: `app.current_user_id()` retorna NULL (claim vacío) → `28000 invalid_authorization_specification`.
- [ ] Place inexistente: caller = owner-A, target = bob, `p_place_id = 'nonexistent'` → `P0001 place not found`.
- [ ] Membership con `left_at NOT NULL`: target = eve (membership con `left_at = now()` — ex-miembro) → `P0001 target is not an active member` (tratada como inactiva).

**Total S2: 8 tests.**

---

## S3 — `app.revoke_ownership` (migration 0014)

### `src/db/__tests__/revoke-ownership.test.ts` (nuevo)

**Por qué importa:** mutador con la mayor superficie de invariantes (5 pre-conditions). Bug = founder borrado accidentalmente, auto-revoke pasando, place huérfano sin owner.

**Harness:** `inRlsTx` con seed-as-`neondb_owner` (2 places — place-1 activo + place-archived; 4 users; ownerships: alice founder + owner de place-1, bob co-owner de place-1, alice founder + owner de place-archived).

**Casos cubiertos (10 total):**

- [ ] Happy: caller = alice (founder + owner), target = bob (co-owner) → DELETE fila `(place_1, bob)`; `membership` de bob preservada (assert: SELECT count(*) FROM membership WHERE place_id = place_1 AND user_id = bob = 1).
- [ ] Target = founder: caller = bob (co-owner), target = alice (founder) → `P0001 cannot revoke founder ownership`.
- [ ] Target = caller (auto-revoke): caller = bob, target = bob → `P0001 cannot self-revoke ownership; use transfer or future step-down`.
- [ ] Caller no-owner: caller = carol (sólo miembro, no owner), target = bob → `P0001 caller is not an owner of this place`.
- [ ] Target no-owner: caller = alice, target = carol (miembro pero NO owner) → `P0001 target is not an owner of this place`.
- [ ] Cross-place: caller = alice (owner de place-1), target = un owner de place-2 (un place donde alice NO es owner) → `P0001 caller is not an owner of this place` (helper rechaza por scoping antes de tocar target).
- [ ] Defense-in-depth N=1 founder + target founder: simular caso patológico — caller = founder, target = founder (que es el único owner) → bloqueado x2 (primero por "cannot revoke founder", segundo por `count(owners) = 1`). Test confirma el primer error gana (founder-check antes que count-check).
- [ ] Caller sin sesión: claim vacío → `28000`.
- [ ] Place archived: caller = alice (founder + owner de place-archived), target — bob co-owner del archived → `P0001 target is not an owner of this place` (bob no es owner del archived en el seed); ajustar seed para incluir bob como co-owner de place-archived y assert: DELETE OK, place archived NO bloquea revoke (decisión spec §"Decisión operativa").
- [ ] Regression cross-place by membership: caller = alice owner de place-1, target = bob (NO miembro de place-1) → `P0001 target is not an owner of this place` (chequeo de owner cubre el caso de no-miembro by transitividad — un no-miembro no puede ser owner).

**Total S3: 10 tests.**

---

## S4 — `app.transfer_founder_ownership` (migration 0015)

### `src/db/__tests__/transfer-founder-ownership.test.ts` (nuevo)

**Por qué importa:** operación con efecto compuesto (UPDATE + DELETE atómicos). Bug = founder duplicado, founder huérfano, o caller pierde ownership pero target no asume slot.

**Harness:** `inRlsTx` con seed (2 places + 4 users + ownerships: alice founder + owner de place-1, bob co-owner de place-1, alice founder + sólo owner de place-solo).

**LOC budget estimado:** ~230. Plan B split si excede 295: `transfer-founder-structural.test.ts` (5 tests pre-conditions, ~120 LOC) + `transfer-founder-matrix.test.ts` (5 tests happy + regression, ~110 LOC).

**Casos cubiertos (10 total):**

- [ ] Happy: caller = alice (founder), target = bob (co-owner) → `place_1.founder_user_id = bob_user_id` + DELETE fila `(place_1, alice)` en `place_ownership`; `membership` de alice preservada (assert: SELECT count(*) FROM membership WHERE place_id = place_1 AND user_id = alice = 1).
- [ ] Caller no-founder: caller = bob (co-owner pero NO founder), target = alice → `P0001 caller is not the founder of this place`.
- [ ] Target no-owner: caller = alice, target = carol (miembro pero NO owner) → `P0001 target is not an owner; elevate first`.
- [ ] Target = caller: caller = alice, target = alice → `P0001 cannot transfer to self`.
- [ ] N=1 founder solo: caller = alice (founder único de place-solo), target = bob (no es owner de place-solo) → `P0001 target is not an owner; elevate first` (refuerza "no transfer without successor" — debe elevar primero).
- [ ] Cross-place: caller = alice (founder de place-1), target = un owner de place-2 (donde alice no es founder), `p_place_id = place_2` → `P0001 caller is not the founder of this place`.
- [ ] Caller sin sesión: claim vacío → `28000`.
- [ ] Place archived: caller = alice founder de place-archived, target = bob (co-owner del archived, agregar al seed) → assert UPDATE + DELETE OK; place archived NO bloquea transfer (decisión spec §"Decisión operativa").
- [ ] Atomicidad contract test: assert que UPDATE + DELETE ocurren en la misma tx implícita del DEFINER — el test no puede forzar fallo PG-side post-DELETE, pero fija el contract de que el cuerpo PL/pgSQL es una sola tx (sin `COMMIT` intermedio, sin savepoints visibles).
- [ ] Regression post-transfer: tras transfer alice→bob de place-1, assert (a) `place_1.founder_user_id = bob_user_id`, (b) bob es owner (fila intacta), (c) alice NO es owner (fila eliminada), (d) alice sigue miembro activo (`membership.left_at IS NULL`).

**Total S4: 10 tests.**

---

## S5 — `app.create_place` regression (sin migration nueva — refactor anticipado a S1 migration 0013)

### `src/db/__tests__/create-place-founder.test.ts` (nuevo o extender `create-place.test.ts` si existe)

**Por qué importa:** la migration 0013 (S1) refinó `app.create_place` para setear `founder_user_id := caller.user_id`. S5 ejecuta regression tests sobre esa migration ya aplicada — confirma que nuevos places nacen con founder correcto + que el wire-up no introdujo privilege escalation. Bug = nuevos places nacen con founder = otro user, o sin founder (NOT NULL violation).

**Harness:** `inRlsTx` con seed-as-`neondb_owner` (3 users distintos: alice, bob, carol).

**Casos cubiertos (5 total):**

- [ ] New place: caller = alice → `app.create_place(slug, name, ...)` → assert `place.founder_user_id = alice.user_id` (nueva asserción post-S5).
- [ ] Back-fill idempotente: re-run de la migration 0012 (simular con `UPDATE place SET founder_user_id = (SELECT MIN logic)`) → no cambia datos existentes (assert: filas pre-S5 + filas post-S5 inalteradas).
- [ ] Smoke multi-user: alice crea place-A, bob crea place-B, carol crea place-C → cada place tiene `founder_user_id` distinto matcheando el creator (3 asserts independientes).
- [ ] NOT NULL post-insert: cualquier place creado por `app.create_place` post-S5 tiene `founder_user_id NOT NULL` (regression test que el wire-up del INSERT del refactor no olvida el campo).
- [ ] Regression ADR-0012: tests existentes de `create_place` (membership creada, place creada, ownership inicial creado) siguen verdes — assertar via cobertura amplia del test extendido o re-run de los existentes en la misma session.

**Total S5: 5 tests.**

---

## S6 — Smoke E2E manual + gotcha doc + cierre operativo

### Verificación manual (no en CI)

- [ ] Las 4 funciones DEFINER corren end-to-end contra Neon test branch con `psql` directo (script ad-hoc, no committed) — ver `spec.md` §"Smoke verification" para los 5 steps canónicos del smoke (create + elevate + revoke founder denial + transfer + INSERT direct denial).
- [ ] INSERT direct a `place_ownership` desde código de feature (simulado vía `psql` con rol `app_system`) → `ERROR: permission denied for table place_ownership` (regression del REVOKE de S1).
- [ ] `docs/gotchas/place-ownership-defining-functions-only.md` creado: "no insertar/actualizar/borrar `place_ownership` desde código de feature — pasa por las 4 funciones DEFINER (`create_place` + `elevate_to_owner` + `revoke_ownership` + `transfer_founder_ownership`); síntoma de drift = `ERROR: permission denied for table place_ownership`".
- [ ] `docs/gotchas/README.md` actualizado con la entry del nuevo gotcha.

### Pre-push checklist (gating push autorizado)

- [ ] `pnpm typecheck` clean — el schema regenerated por Drizzle introspect no rompe tipos.
- [ ] `pnpm lint` clean — sin warnings de los archivos nuevos.
- [ ] `pnpm test` verde — suite total = baseline pre-Feature-D + 47 tests nuevos (S1: 14, S2: 8, S3: 10, S4: 10, S5: 5).
- [ ] `pnpm build` exitoso — Next 16 build sin warnings.
- [ ] `git diff baseline/feature-d-s5-done -- src/` empty (S6 sólo toca docs + gotchas).
- [ ] LOC budget verificado: cada archivo nuevo ≤ 300 LOC; sub-módulo afectado ≤ 800 LOC.

**Total S6: ≥5 verificaciones manuales + suite verde gating push.**

---

## Coverage acumulado

V1 esperado al cierre S6:

| Sesión | Tests vitest nuevos | Verificaciones manuales |
|---|---|---|
| S1 — Migration 0012 + RLS refactor + helper | 14 | 4 psql |
| S2 — `app.elevate_to_owner` | 8 | — |
| S3 — `app.revoke_ownership` | 10 | — |
| S4 — `app.transfer_founder_ownership` | 10 | — |
| S5 — `app.create_place` regression | 5 | — |
| S6 — Smoke + gotcha + cierre | — | ≥5 psql/manual |
| **Total nuevo** | **47 vitest** | **≥9 manual/psql** |

S6 smoke + gating push NO se contabilizan como tests vitest.

---

## Lo que NO probamos (decisión)

- **RLS owner-only de `place`/`membership`/`invitation`/`place_domain`** — ya cubierto por suites existentes desde ADR-0012; Feature D NO modifica esas policies, sólo refactora `place_ownership`. Tests existentes deben seguir verdes (regression implícita en suite total).
- **Wrappers TS** — V1 no los tiene. V1.1+ tests del wrapper + tipos de error de dominio (`ElevateError`/`RevokeError`/`TransferError`).
- **UI** — V1 sin UI. V1.1+ tests RTL del componente `<CoOwnersSection>` cuando exista.
- **i18n parity** — V1 sin keys nuevas. V1.1+ con el bloque `placeSettings.coOwners.*`.
- **Server Actions** — V1 no las hay. V1.1+ con tests de wire-up del action + revalidación de paths.
- **Notificaciones** — V1 no notifica al ex-owner revocado. V1.1+ con tests de cola de notifs.
- **Auto-revoke (`step_down_as_owner`)** — V1 lo rechaza explícitamente en `revoke_ownership` (test cubre el rechazo); la función misma no existe.
- **Concurrent transfers** — V1 confía en el lock implícito de `UPDATE place WHERE id = ...` (SELECT FOR UPDATE no necesario en una tx que ya tiene el row lock por UPDATE). V1.1+ podría agregar un test concurrent si telemetría detecta race.
- **Performance** — no se mide en vitest. Volumen V1 esperado: < 10 `elevate`/`revoke`/`transfer` por place per mes; sub-ms en PG. Cost budget no aplica.

---

## Pointers

- **ADR canónica V1**: [`../../decisions/0035-place-ownership-multi-owner-v1.md`](../../decisions/0035-place-ownership-multi-owner-v1.md).
- **Spec del feature**: [`./spec.md`](./spec.md).
- **Plan de sesiones**: [`./plan-sesiones.md`](./plan-sesiones.md).
- **Precedente harness RLS**: `src/db/__tests__/db-test-pool.ts` (`inRlsTx` — seed-as-`neondb_owner`, assert-as-`app_system`, ROLLBACK siempre).
- **Precedente test SQL directo SECURITY DEFINER**: `src/db/__tests__/consume-sso-jti.test.ts` (Feature C S1, mismo patrón de inyección de claim vacío + assert RAISE EXCEPTION + REVOKE PUBLIC enforcement).
- **ADRs relacionadas**: ADR-0002 §1 (refinada por 0035 — multi-owner explícito), ADR-0003 §1 (refinada por 0035 — exención owner literal post-multi-owner), ADR-0006 (FK lógica sin hard FK), ADR-0011 (`app.current_user_id()` + rol `app_system`), ADR-0012 §2 + §3 (RLS recursion-safe + `app.create_place` SECURITY DEFINER pattern), ADR-0032 §6 (`app.consume_sso_jti` precedente WORM-via-DEFINER).
