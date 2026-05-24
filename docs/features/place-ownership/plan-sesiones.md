# `place_ownership` multi-owner V1 — Plan de sesiones (S0 esqueleto)

> _Plan creado 2026-05-24 (S0 de Feature D). Esqueleto de las 6 sesiones (S1-S6) — el detalle de implementación lo arma cada sesión cuando arranque. Decisión canónica en [ADR-0035](../../decisions/0035-place-ownership-multi-owner-v1.md). Spec en [`./spec.md`](./spec.md). Tests TDD en [`./tests.md`](./tests.md). Baseline pre-implementación: `baseline/pre-feature-d` = `aaf238b`._

## Status

**Feature D V1 cerrada end-to-end** (2026-05-24, S0–S6 ✓). Smoke E2E 5/5 verde contra branch ephemeral Neon `smoke-feature-d-s6-2026-05-24` (off production, cleaned). Pre-push checklist: typecheck/lint/test/build verde + `git diff baseline/feature-d-s5-done -- src/` empty (S6 sólo docs). Push pendiente de autorización turn-by-turn del user.

SHAs por sesión (todas locales pre-push):

| Sesión | Commit SHA | Tag baseline | Resumen |
|---|---|---|---|
| S0 | `f7cb47a` (off save point `aaf238b`) | `baseline/feature-d-s0-done` | Docs ADR-0035 + spec + tests + plan-sesiones + banner refinements |
| S1 | `d4b4d03` | `baseline/feature-d-s1-done` | Migrations 0012+0013 — WORM-via-DEFINER + helper `current_user_owns_place` + `founder_user_id` + refactor `app.create_place` (5+6 arg) — 14 tests TDD verdes |
| S2 | `76d6ecc` | `baseline/feature-d-s2-done` | Migration 0014 — `app.elevate_to_owner` SECURITY DEFINER — 8 tests TDD verdes |
| S3 | `d34aab0` | `baseline/feature-d-s3-done` | Migration 0015 — `app.revoke_ownership` SECURITY DEFINER — 10 tests TDD verdes |
| S4 | `191c07a` | `baseline/feature-d-s4-done` | Migration 0016 — `app.transfer_founder_ownership` SECURITY DEFINER — 10 tests TDD verdes |
| S5 | `c979b4b` | `baseline/feature-d-s5-done` | 5 regression tests `create_place` founder + `data-model.md` write-back (sin migration nueva) |
| S6 | (resuelto vía tag) | `baseline/feature-d-s6-done` | Smoke E2E 5/5 + gotcha `place-ownership-defining-functions-only.md` + README index + write-back plan-sesiones + spec §"Smoke ejecutado" |

Suite final: **761/761 verde** (baseline pre-Feature-D 714 + 47 nuevos: S1 14 + S2 8 + S3 10 + S4 10 + S5 5).

> **Ajuste operacional (2026-05-24, hot-patch durante S1):** el refactor de
> `app.create_place` (originalmente planeado para S5 migration 0016) se
> **anticipó a S1 como migration 0013** por gap del plan S0: el `SET NOT NULL`
> de `founder_user_id` (S1) sin refactor del único caller oficial
> (`app.create_place`) creaba ventana de fragilidad S1-S5 donde la creación
> de places fallaba en runtime con `23502 not_null_violation`. Pattern
> industry-standard expand-contract: no aplicamos constraint hasta que la
> única vía de creación lo respete. Consecuencia: migrations S2/S3/S4 bumpean
> a 0014/0015/0016; S5 queda con sólo regression tests + `data-model.md`
> write-back (sin migration nueva).

Comando de rollback total inmediato (estado pre-Feature-D):

```bash
git reset --hard baseline/pre-feature-d
```

## Sesiones

### S1 — Migration 0012 + 0013: refactor RLS + helper DEFINER + back-fill + create_place setea founder

**Objetivo único**: cerrar el refactor estructural de `place_ownership` — DROP de policies SELF, REVOKE INSERT/UPDATE/DELETE, helper `app.current_user_owns_place` SECURITY DEFINER, nueva policy `po_sel` con helper, ALTER `place` + back-fill `founder_user_id` + SET NOT NULL + refactor de `app.create_place` para setear founder en el INSERT (anticipado de S5 — ver Ajuste operacional arriba).

**Archivos esperados** (5-8):
- `src/db/migrations/0012_place_ownership_worm_via_definer.sql` (migration nueva).
- `src/db/migrations/0013_app_create_place_set_founder.sql` (migration nueva — anticipada de S5).
- `src/db/__tests__/rls-place-ownership.test.ts` (14 tests TDD nuevos). LOC budget: 250-280; si excede 295 → Plan B split en `rls-place-ownership-structural.test.ts` + `rls-place-ownership-matrix.test.ts`.
- `src/db/schema/index.ts` — edición manual quirúrgica: `place.founderUserId text NOT NULL` + reemplazo de las 3 policies SELF (`po_sel`/`po_upd`/`po_del`) por única `po_sel` via helper SECURITY DEFINER. Drizzle introspect no genera ni SECURITY DEFINER ni REVOKE — todo el SQL crítico vive en migrations a mano.
- `src/db/migrations/meta/_journal.json` actualizado (entries 12 + 13).
- **Hot-fix Tipo B** (test seeds raw que crean places sin `founder_user_id`): 7 archivos de tests existentes con `INSERT INTO place (slug,name,billing_mode)` raw necesitan agregar `founder_user_id` en su seed — los Tipo A (que usan `app.create_place`) se autofixean con migration 0013. Archivos tocados: `rls.test.ts`, `rls-place-domain.test.ts`, `auth-db.test.ts`, `db-with-verifier.test.ts`, `lookup-place-by-domain.test.ts`, `lookup-place-locale-by-slug.test.ts`, `get-inbox-payload.test.ts`, `load-place-by-slug.test.ts`.

**Locked files** (NO modificar):
- `docs/decisions/0035-place-ownership-multi-owner-v1.md` — canónica.
- `docs/data-model.md` — refinado en S5.
- `docs/multi-tenancy.md` — sección RLS refinada en S1 (DESPUÉS de cerrar este test, no antes).
- Cualquier archivo en `src/features/` (V1 no toca features).

**Tests TDD**: ver `tests.md` §S1 (14 tests + 4 verificaciones manuales psql).

**LOC budget estimado**: migration ~80 LOC, test ~250-280 LOC. Total ≤ 360 LOC. Cap por archivo 300 respetado vía Plan B split si necesario.

**Pre-commit checklist**:
- [ ] `pnpm test src/db/__tests__/rls-place-ownership` verde (14/14).
- [ ] `pnpm typecheck` verde (schema regenerated válido).
- [ ] Verificaciones psql del cierre S1 ejecutadas y logueadas (4 asserts).
- [ ] Header de la migration documenta reverse-SQL inline.
- [ ] `git status --short` sólo muestra los 3-4 paths esperados.
- [ ] `wc -l` de cada archivo nuevo ≤ 300 (ó split aplicado).

**Commit message format**:
```
feat(db): migration 0012 — place_ownership WORM-via-DEFINER + helper current_user_owns_place + founder_user_id

- DROP policies po_sel/po_upd/po_del SELF; CREATE po_sel via app.current_user_owns_place(place_id)
- REVOKE INSERT/UPDATE/DELETE on place_ownership FROM app_system (defense-in-depth)
- ALTER place ADD COLUMN founder_user_id text + back-fill MIN(granted_at).user_id + SET NOT NULL
- 14 tests TDD verdes (rls-place-ownership.test.ts)

Ref: ADR-0035 §3 + §Decisión 2.
```

**Tag baseline esperado**: `baseline/feature-d-s1-done`.

---

### S2 — Migration 0014: `app.elevate_to_owner` SECURITY DEFINER

**Objetivo único**: implementar la función DEFINER que canaliza el INSERT en `place_ownership` para promover un miembro activo a co-owner, validando 5 invariantes en cuerpo.

**Archivos esperados** (2):
- `src/db/migrations/0014_app_elevate_to_owner.sql` (nueva migration con la función `LANGUAGE plpgsql` + `SECURITY DEFINER` + `SET search_path = public, pg_temp` + REVOKE PUBLIC + GRANT `app_system`).
- `src/db/__tests__/elevate-to-owner.test.ts` (8 tests TDD nuevos).

**Locked files** (NO modificar):
- Migration 0012 (cerrada en S1).
- `app.create_place` (refactor diferido a S5).
- `docs/decisions/0035-place-ownership-multi-owner-v1.md`.

**Tests TDD**: ver `tests.md` §S2 (8 tests).

**LOC budget estimado**: migration ~60 LOC, test ~180 LOC. Total ≤ 240 LOC.

**Pre-commit checklist**:
- [ ] `pnpm test src/db/__tests__/elevate-to-owner` verde (8/8).
- [ ] `pnpm typecheck` verde.
- [ ] Verificación psql: `\df app.elevate_to_owner` muestra `Security` = `definer`.
- [ ] Header de la migration documenta reverse-SQL inline.

**Commit message format**:
```
feat(db): migration 0014 — app.elevate_to_owner SECURITY DEFINER + 8 tests TDD

Ref: ADR-0035 §Decisión 2 (CU2). Pre-conditions in body:
caller owns place; target active member; target not already owner; place exists.
```

**Tag baseline esperado**: `baseline/feature-d-s2-done`.

---

### S3 — Migration 0015: `app.revoke_ownership` SECURITY DEFINER

**Objetivo único**: implementar la función DEFINER que canaliza el DELETE de `place_ownership` para remover un co-owner, validando 6 invariantes en cuerpo (founder no-delete + no self-revoke + caller owner + target owner + N>1 defense-in-depth + scoping).

**Archivos esperados** (2):
- `src/db/migrations/0015_app_revoke_ownership.sql`.
- `src/db/__tests__/revoke-ownership.test.ts` (10 tests TDD nuevos).

**Locked files** (NO modificar):
- Migrations 0012/0013.
- `app.create_place` (refactor diferido a S5).
- `docs/decisions/0035-place-ownership-multi-owner-v1.md`.

**Tests TDD**: ver `tests.md` §S3 (10 tests).

**LOC budget estimado**: migration ~80 LOC, test ~220 LOC. Total ≤ 300 LOC. Si test excede 295 → Plan B split en `revoke-ownership-structural.test.ts` (pre-conditions) + `revoke-ownership-matrix.test.ts` (happy + regression).

**Pre-commit checklist**:
- [ ] `pnpm test src/db/__tests__/revoke-ownership` verde (10/10).
- [ ] `pnpm typecheck` verde.
- [ ] Verificación psql: `\df app.revoke_ownership` muestra `Security` = `definer`.
- [ ] Header de la migration documenta reverse-SQL inline.

**Commit message format**:
```
feat(db): migration 0015 — app.revoke_ownership SECURITY DEFINER + 10 tests TDD

Ref: ADR-0035 §Decisión 2 (CU3) + §4 (WORM defense-in-depth N>1).
Founder no-delete + no self-revoke V1 enforced en cuerpo.
```

**Tag baseline esperado**: `baseline/feature-d-s3-done`.

---

### S4 — Migration 0016: `app.transfer_founder_ownership` SECURITY DEFINER

**Objetivo único**: implementar la función DEFINER que canaliza el `UPDATE place.founder_user_id` + `DELETE place_ownership` (caller) de forma atómica, validando 5 invariantes en cuerpo (caller founder + target owner + target ≠ caller + place exists + autenticación).

**Archivos esperados** (2):
- `src/db/migrations/0016_app_transfer_founder_ownership.sql`.
- `src/db/__tests__/transfer-founder-ownership.test.ts` (10 tests TDD nuevos). LOC budget: ~230. Plan B split si excede 295.

**Locked files** (NO modificar):
- Migrations 0012/0013/0014.
- `app.create_place` (refactor diferido a S5).
- `docs/decisions/0035-place-ownership-multi-owner-v1.md`.

**Tests TDD**: ver `tests.md` §S4 (10 tests).

**LOC budget estimado**: migration ~80 LOC, test ~230 LOC. Total ≤ 310 LOC (con Plan B split aplicable).

**Pre-commit checklist**:
- [ ] `pnpm test src/db/__tests__/transfer-founder-ownership` verde (10/10).
- [ ] `pnpm typecheck` verde.
- [ ] Verificación psql: `\df app.transfer_founder_ownership` muestra `Security` = `definer`.
- [ ] Header de la migration documenta reverse-SQL inline.

**Commit message format**:
```
feat(db): migration 0016 — app.transfer_founder_ownership SECURITY DEFINER + 10 tests TDD

Ref: ADR-0035 §Decisión 2 (CU4). Atomic UPDATE founder + DELETE caller-ownership.
Pre-condition: target ya owner (no transfer-without-successor).
```

**Tag baseline esperado**: `baseline/feature-d-s4-done`.

---

### S5 — Regression tests `app.create_place` + data-model.md write-back (sin migration nueva)

**Objetivo único**: 5 regression tests sobre `app.create_place` (verifica que setea `founder_user_id` correctamente — el refactor mismo se hizo en S1 migration 0013) + completar la sección final de `data-model.md` con el schema post-migrations + invariantes nuevos.

**Archivos esperados** (2):
- `src/db/__tests__/create-place-founder.test.ts` o extensión de `create-place.test.ts` existente (5 tests TDD nuevos — regression sobre la migration 0013 ya aplicada en S1).
- `docs/data-model.md` — sección `place` añade `founder_user_id text NOT NULL`; sección `place_ownership` refleja "INSERT/UPDATE/DELETE denegado por REVOKE — toda mutación vía 4 funciones DEFINER"; sección "Invariantes del dominio" agrega "founder slot único per place, no-delete por otro owner" + "transferencia founder requiere target owner pre-existente" + "exención owner literal post-multi-owner: cualquier owner extiende la exención mientras el place esté activo".

**Locked files** (NO modificar):
- Migrations 0012/0013/0014/0015.
- `docs/decisions/0035-place-ownership-multi-owner-v1.md`.
- `docs/multi-tenancy.md` (refinada en S1; en S5 sólo se valida que el bullet `place_ownership` siga coherente).
- `docs/decisions/0002-roles-gamificacion-handle.md` + `docs/decisions/0003-lifecycle-cuenta-place-tombstone.md` (refinadas por otros agentes ya con banner top — no se vuelven a tocar).
- `docs/decisions/README.md` (refinado por otro agente).

**Tests TDD**: ver `tests.md` §S5 (5 tests).

**LOC budget estimado**: migration ~50 LOC, test ~120 LOC, `data-model.md` delta ~30-50 LOC dentro de su sección existente (cap del archivo respetado).

**Pre-commit checklist**:
- [ ] `pnpm test src/db/__tests__/create-place-founder` verde (5/5).
- [ ] `pnpm test` total verde (regression suite ADR-0012 intacta).
- [ ] `pnpm typecheck` verde.
- [ ] Verificación psql: `SELECT founder_user_id FROM place ORDER BY created_at DESC LIMIT 1` retorna el creator del último place creado en test branch.
- [ ] `wc -l docs/data-model.md` dentro del cap del archivo.

**Commit message format**:
```
docs+test(db): 5 regression tests app.create_place founder + data-model.md write-back

Ref: ADR-0035 §Consecuencias (data-model.md). Refactor de app.create_place
ya aplicado en S1 (migration 0013, anticipado por gap del plan original S5).
```

**Tag baseline esperado**: `baseline/feature-d-s5-done`.

---

### S6 — Smoke E2E manual + gotcha + cierre operativo + push autorizado por turno

**Objetivo único**: validar end-to-end las 4 funciones DEFINER contra Neon test branch, crear el gotcha canónico, cerrar el plan con write-back de SHAs reales, push autorizado por turno explícito del user.

**Archivos esperados** (3-4):
- `docs/gotchas/place-ownership-defining-functions-only.md` (nuevo).
- `docs/gotchas/README.md` (entry nueva).
- `docs/features/place-ownership/plan-sesiones.md` (write-back con SHAs reales — este archivo).
- `docs/features/place-ownership/spec.md` (sección "Smoke verification" actualizada con resultados — opcional según output del smoke).

**Locked files** (NO modificar):
- Todas las migrations + tests + schema (cerradas en S5).
- `docs/decisions/0035-place-ownership-multi-owner-v1.md`.
- Cualquier archivo en `src/`.

**Tests TDD**: ver `tests.md` §S6 (smoke manual + gating push).

**LOC budget estimado**: gotcha ~40 LOC, README entry ~5 LOC, write-back delta plan-sesiones ~30 LOC.

**Pre-commit checklist (pre-push)**:
- [ ] Smoke E2E manual ejecutado y logueado: 5 steps del `spec.md` §"Smoke verification" pasan.
- [ ] INSERT direct a `place_ownership` simulado → `permission denied for table place_ownership`.
- [ ] `pnpm typecheck` clean.
- [ ] `pnpm lint` clean.
- [ ] `pnpm test` verde (baseline + 47 tests acumulados).
- [ ] `pnpm build` exitoso.
- [ ] `git diff baseline/feature-d-s5-done -- src/` empty (S6 sólo toca docs).
- [ ] Push autorizado **explícitamente** por el user en el turno de S6 (memoria operacional: nunca push sin autorización turno-a-turno).

**Commit message format**:
```
docs: cierre Feature D V1 — smoke E2E verde + gotcha place-ownership + write-back plan-sesiones

- Gotcha place-ownership-defining-functions-only documentado.
- Smoke ejecutado contra Neon test branch: 4 funciones DEFINER + REVOKE regression verdes.
- Plan-sesiones write-back con SHAs S1-S5 reales.

Ref: ADR-0035 (V1 cerrada end-to-end).
```

**Tag baseline esperado**: `baseline/feature-d-s6-done` (= V1 cerrada).

---

## Mecanismo de rollback

Rollback granular por sesión vía tags `baseline/feature-d-s<N>-done` + rollback total al punto absoluto pre-Feature-D vía `baseline/pre-feature-d` (commit `aaf238b`).

```bash
# Rollback total (estado pre-Feature-D, equivalente a Feature C done):
git reset --hard baseline/pre-feature-d

# Rollback granular S<N>:
git reset --hard baseline/feature-d-s<N-1>-done

# Ejemplos concretos:
#   - Tras S3 detecta bug en S3: rollback a baseline/feature-d-s2-done.
#   - Tras S5 detecta regression en S5: rollback a baseline/feature-d-s4-done.
#   - Tras S6 detecta gotcha incompleta: rollback a baseline/feature-d-s5-done + retomar.
```

**Pre-condición rollback con migration aplicada en Neon branch**: si las migrations 0012-0016 ya se aplicaron a la branch Neon afectada (preview o test), el reverse-SQL manual es necesario antes del próximo deploy (Drizzle journal no soporta `down` automático). Cada migration documenta su reverse en el header.

**Push reversal**: si el push de S6 ya ocurrió pero smoke production detecta regression, rollback = `git revert <commit-sha>` + nuevo push (NO `git reset` en remote main). Decisión por turno con user.

## Reverse SQL manual por migration (esqueleto)

Cada migration documenta inline en su header el reverse-SQL exacto. Esqueleto canónico:

```sql
-- 0012 reverse (S1): REVOKE EXECUTE + DROP FUNCTION app.current_user_owns_place(text);
--   DROP POLICY po_sel ON place_ownership + CREATE POLICY po_sel/po_upd/po_del SELF (cuerpo previo);
--   GRANT UPDATE,DELETE ON place_ownership TO "app_system" (INSERT ya revocado en 0001);
--   ALTER TABLE place DROP COLUMN founder_user_id (precedido por reverse de 0013).
-- 0013 reverse (S1): CREATE OR REPLACE FUNCTION app.create_place(...) con cuerpo
--   previo (sin la línea de founder_user_id en el INSERT) — ambos overloads 5-arg y 6-arg.
-- 0014 reverse (S2): REVOKE EXECUTE + DROP FUNCTION app.elevate_to_owner(text, text).
-- 0015 reverse (S3): REVOKE EXECUTE + DROP FUNCTION app.revoke_ownership(text, text).
-- 0016 reverse (S4): REVOKE EXECUTE + DROP FUNCTION app.transfer_founder_ownership(text, text).
-- S5 sin migration nueva (sólo regression tests + data-model.md write-back).
```

Cada sesión que aplique su migration tiene la responsabilidad de validar que el reverse del header efectivamente revierte limpio antes de tag baseline.

## Pointers

- **ADR canónica V1**: [`../../decisions/0035-place-ownership-multi-owner-v1.md`](../../decisions/0035-place-ownership-multi-owner-v1.md).
- **Spec del feature**: [`./spec.md`](./spec.md).
- **Tests TDD checklist**: [`./tests.md`](./tests.md).
- **Save point absoluto pre-Feature-D**: tag `baseline/pre-feature-d` = commit `aaf238b`.
- **Precedente plan ejecutado (referencia de patrón)**: [`../custom-domain-sso/plan-sesiones.md`](../custom-domain-sso/plan-sesiones.md).
- **Precedente migration SECURITY DEFINER**: `src/db/migrations/0011_app_consume_sso_jti.sql` (Feature C S1).
