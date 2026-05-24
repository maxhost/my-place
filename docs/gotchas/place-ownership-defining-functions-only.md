# INSERT/UPDATE/DELETE directos sobre `place_ownership` están denegados — toda mutación pasa por 4 funciones SECURITY DEFINER

## Síntoma

Cualquier código de feature (action server, job, migration nueva, repl ad-hoc) que ejecute `INSERT INTO place_ownership ...`, `UPDATE place_ownership SET ...` o `DELETE FROM place_ownership WHERE ...` bajo el rol runtime `app_system` aborta con:

```
ERROR:  permission denied for table place_ownership
```

El síntoma confunde porque (a) la tabla **existe y es SELECT-able** (los owners ven sus filas vía la policy `po_sel`), (b) el caller tiene sesión válida (claim no-vacío) y suele ser owner del place, (c) el código análogo sobre `place`, `membership` o `invitation` funciona sin fricción. La query no es rechazada por RLS (`USING` false) — es **rechazada por el grant SQL del rol**, antes de evaluar policy. Resultado: el path falla durante desarrollo (o, peor, en producción) sin pista obvia del por qué.

## Causa

Migration `0012_place_ownership_worm_via_definer.sql` (Feature D S1, ADR-0035 §3 + §4) introdujo el patrón **WORM-via-DEFINER** (Write-Once-Read-Many vía SECURITY DEFINER) sobre `place_ownership`. Cierra 3 asimetrías estructurales del schema previo (policies SELF, `po_upd` sin WITH CHECK, cero enforcement del invariante "mínimo 1 owner por place activo") + abre el modelo a multi-owner desde V1 + protege el founder slot:

```sql
-- po_sel única, FOR SELECT via helper SECURITY DEFINER (owners ven todas las filas
-- del place — necesario para UI futuro + para que revoke_ownership lea la lista).
CREATE POLICY "po_sel" ON "place_ownership"
  AS PERMISSIVE FOR SELECT TO "app_system"
  USING (app.current_user_owns_place(place_id));

-- INSERT/UPDATE/DELETE: SIN POLICY (denegadas por construcción) + REVOKE explícito.
-- Defense-in-depth, mismo patrón place/membership de migration 0001.
REVOKE UPDATE, DELETE ON TABLE "place_ownership" FROM "app_system";
-- (INSERT ya estaba revocado en 0001:54 — parte del WORM original.)
```

El grant SQL del rol gana sobre la policy: aunque la policy permitiera la mutación, sin EXECUTE/INSERT/UPDATE/DELETE grant al rol, la query aborta con `42501 insufficient_privilege` antes de evaluar `USING`/`WITH CHECK`. Toda mutación de `place_ownership` y toda mutación de `place.founder_user_id` pasa exclusivamente por **4 funciones SECURITY DEFINER** que validan invariantes en el cuerpo plpgsql:

| Función | Migration | CU spec | Pre-conditions in body |
|---|---|---|---|
| `app.create_place(...)` | `0013_app_create_place_set_founder.sql` (refactor) | CU1 — crear place (founder automático) | autenticado, app_user lookup; INSERT atómico place + place_ownership + membership con `founder_user_id := caller.user_id`. |
| `app.elevate_to_owner(p_to_user_id, p_place_id)` | `0014_app_elevate_to_owner.sql` | CU2 — promover miembro a co-owner | autenticado, app_user, place exists, caller is owner, target NOT already owner, target IS active member. |
| `app.revoke_ownership(p_target_user_id, p_place_id)` | `0015_app_revoke_ownership.sql` | CU3 — revocar co-owner | autenticado, app_user, caller is owner, target is owner, target NOT founder, target NOT caller (no self-revoke V1), `count(owners) > 1` defense-in-depth. |
| `app.transfer_founder_ownership(p_to_user_id, p_place_id)` | `0016_app_transfer_founder_ownership.sql` | CU4 — transferir founder | autenticado, app_user, place exists, caller IS founder, target IS owner pre-existente (no transfer-without-successor), target ≠ caller. Atómico: UPDATE founder + DELETE caller-ownership. |

Las 4 funciones son `LANGUAGE plpgsql` + `SECURITY DEFINER` + `SET search_path = public, pg_temp` (anti-hijack), con `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO "app_system"`. Validan invariantes en el cuerpo y emiten `RAISE EXCEPTION ... USING errcode = 'P0001'` con mensaje estructural cuando se violan (el wrapper TS V1.1+ discrimina por code).

## Invariante going-forward

**Todo nuevo touch a `place_ownership` desde código de feature pasa por una de las 4 funciones DEFINER — nunca SQL directo.** Razones canonicalizadas en ADR-0035:

1. **Single source of truth para invariantes.** Las pre-conditions ("caller owns place", "target not already owner", "founder no-delete", "no self-revoke V1", "count(owners) > 1") viven en el cuerpo plpgsql de las funciones. SQL directo desde features bypasea TODAS — privilege escalation + founder huérfano + place sin owners viables.
2. **WORM-via-DEFINER es el patrón canónico del proyecto.** Precedentes: `app.create_place` (ADR-0012 §3, migration 0002), `app.consume_sso_jti` (ADR-0032 §6, migration 0011). Feature D V1 extiende el mismo patrón a `place_ownership`.
3. **Defense-in-depth tiene 3 capas alineadas.** (a) Grant SQL del rol (REVOKE INSERT/UPDATE/DELETE FROM `app_system`), (b) Cuerpo plpgsql con `RAISE EXCEPTION` por invariante, (c) UNIQUE constraint `(user_id, place_id)` de migration 0001 captura races concurrentes con `23505 unique_violation`. Las 3 capas son independientes — bypassear una no compromete las otras.

### Si una nueva operación amerita acceso a `place_ownership`

Decidir primero si la operación encaja en una de las 4 CUs existentes:

- **Nuevo owner desde miembro existente** → `app.elevate_to_owner`.
- **Remover co-owner** → `app.revoke_ownership`.
- **Cambiar founder** → `app.transfer_founder_ownership`.
- **Crear place** → `app.create_place` (ya setea founder automático).

Si NO encaja (e.g., bulk migration data, admin tooling fuera del runtime app, auto-revoke V1.1+ `step_down_as_owner`), **abrir ADR explícito** describiendo la nueva función DEFINER + sus pre-conditions + su signature + sus tests TDD antes de mergear. Nunca `GRANT INSERT/UPDATE/DELETE ON place_ownership TO app_system` "temporalmente" — el grant levanta TODAS las protecciones a la vez y no hay forma trivial de revertirlo selectivamente.

### Edge cases legítimos del SQL directo

- **Tests** que necesiten 2+ filas en `place_ownership` con `granted_at` ordenado (e.g., test del back-fill MIN(granted_at) en `create-place-founder.test.ts`): `tx.seed` (admin BYPASSRLS) está autorizado en harness, con comment inline justificando el bypass del flow oficial. Este NO es código de feature.
- **Migrations** de schema futuras: usan `neondb_owner` (no `app_system`) por construcción → bypassean el REVOKE. Cualquier seed-data o transformación de filas existentes en migration está permitido (y esperado para back-fills + recompute).

## Tests pertinentes

- `src/db/__tests__/rls-place-ownership.test.ts` (14 tests) — REVOKE INSERT/UPDATE/DELETE enforced, helper `app.current_user_owns_place` STABLE + DEFINER + EXECUTE-granted, po_sel via helper, back-fill idempotente, structural drift defense via `pg_policies` + `pg_proc`.
- `src/db/__tests__/elevate-to-owner.test.ts` (8 tests) — happy + 7 pre-condition denials.
- `src/db/__tests__/revoke-ownership.test.ts` (10 tests) — founder no-delete + no self-revoke + scoping + defense-in-depth.
- `src/db/__tests__/transfer-founder-ownership.test.ts` (10 tests) — atomic UPDATE+DELETE + caller membership preservada + no transfer-without-successor.
- `src/db/__tests__/create-place-founder.test.ts` (5 tests) — regression sobre migration 0013 (`create_place` setea founder).

Total: **47 tests** corren bajo el rol real `app_system` (NO BYPASSRLS) con claims inyectados vía harness `inRlsTx` — nunca como `neondb_owner` (falso verde por bypass).

## Smoke E2E (Feature D S6, 2026-05-24)

Validado end-to-end contra branch ephemeral Neon (`smoke-feature-d-s6-2026-05-24`, off production):
- **STEP 1** `app.create_place` setea `founder_user_id = caller` ✓ (+ ownership + membership atómicos).
- **STEP 2** `app.elevate_to_owner` happy + duplicate → `target is already an owner` (P0001) ✓.
- **STEP 3** `app.revoke_ownership` denials → `cannot revoke founder ownership` + `cannot self-revoke ownership; use transfer or future step-down` (P0001) ✓.
- **STEP 4** `app.transfer_founder_ownership` atómico → founder cambia + caller pierde ownership + caller membership preservada ✓.
- **STEP 5** `INSERT/UPDATE/DELETE` directos como `app_system` → `permission denied for table place_ownership` (42501) ✓.

## Pointers

- **ADR canónica V1**: `docs/decisions/0035-place-ownership-multi-owner-v1.md`.
- **Spec feature**: `docs/features/place-ownership/spec.md`.
- **Plan operativo**: `docs/features/place-ownership/plan-sesiones.md`.
- **Precedente WORM-via-DEFINER**: `docs/decisions/0012-creacion-place-via-funcion-definer.md` §3 (`app.create_place`) + `docs/decisions/0032-custom-domain-sso-signed-ticket.md` §6 (`app.consume_sso_jti`).
- **Schema base + invariantes**: `docs/data-model.md` (tabla `place_ownership` con comment WORM-via-DEFINER + invariantes del dominio).
- **Migrations**: `src/db/migrations/0012_place_ownership_worm_via_definer.sql` + `0013_app_create_place_set_founder.sql` + `0014_app_elevate_to_owner.sql` + `0015_app_revoke_ownership.sql` + `0016_app_transfer_founder_ownership.sql`.
- **Helpers de test**: `src/db/__tests__/db-test-pool.ts` (`inRlsTx`, `tx.as`, `tx.q`, `tx.seed`).
