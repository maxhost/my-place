# Server Action sobre `place_domain` falla `error`/`not_found` para un miembro no-owner

## Síntoma

Una Server Action que toca `place_domain` (registrar dominio, archivar dominio, leer status de verificación) retorna `{status: 'error'}` o `{status: 'not_found'}` cuando la invoca un **miembro autenticado del place que NO es owner**. El miembro está visiblemente logueado, ve el chrome del place + las pages owner-only renderean (la layout no exige owner-rol explícito), pero al submitear la mutación o leer status del dominio recibe el error genérico.

Logs server-side muestran que la query SQL corrió bajo el JWT del miembro y no retornó filas / no afectó filas — sin error de Postgres ni stack visible (la policy filtra silenciosamente, no rechaza con throw).

## Causa

`place_domain` tiene una **única policy RLS** llamada `place_domain_all`, definida en `src/db/migrations/0001_round_forge.sql:39-45`:

```sql
CREATE POLICY "place_domain_all" ON "place_domain"
  AS PERMISSIVE FOR ALL TO "app_system"
  USING      (EXISTS (SELECT 1 FROM place_ownership po
                      JOIN app_user au ON au.id = po.user_id
                      WHERE po.place_id = "place_domain"."place_id"
                        AND au.auth_user_id = (select app.current_user_id())))
  WITH CHECK (EXISTS (...));   -- mismo predicado
```

Es `FOR ALL` (cubre SELECT/INSERT/UPDATE/DELETE) y `USING == WITH CHECK` (simétrica, defense in depth). El predicado `ownerOnly` exige que el `sub` del JWT (resuelto por `app.current_user_id()`) sea un `app_user` con fila en `place_ownership` del place dueño de la fila objetivo. **Un miembro no-owner falla el predicado → no ve la fila + no la puede mutar.** El motor no tira: simplemente filtra el row, y el `RETURNING id` devuelve cero filas.

## Invariante going-forward

**Todo nuevo touch a `place_domain` desde código de feature DELEGA al RLS** — no se agregan TS-level gates redundantes ("el caller debe ser owner"). Razones:

1. **Single source of truth.** La policy ya enforce owner-only en el motor; un gate TS duplica la regla y abre drift si una cambia y la otra no.
2. **Defense in depth ya cubierta.** `USING == WITH CHECK` simétrica + `app_system` NO BYPASSRLS (tests structural anclan ambos invariantes).
3. **Member-read NO se extiende a config técnica.** El patrón ADR-0021 (`OR exists(membership activa)`) extiende SELECT de `place` + self-row de `membership` a los miembros. **NO se extiende a `place_domain`**: los miembros ven el contenido del place pero NUNCA su configuración técnica (dominio, oauth_client_id, verified_at). Si un futuro refactor agrega `OR exists(membership)` al predicado de `place_domain`, la suite rompe el test `S3 — "miembro NO ve place_domain"` y exige ADR explícito antes de mergear.

### Excepción: SECURITY DEFINER lookup público

`app.lookup_place_by_domain(domain text)` (migration `0009_lookup_place_by_domain.sql`) es **SECURITY DEFINER SELECT-only** con filtro `WHERE verified_at IS NOT NULL AND archived_at IS NULL`. Lo consume el proxy Feature B sin sesión del visitante para resolver `nocodecompany.co → place_id`. Es el ÚNICO bypass legítimo de la policy owner-only, justificado porque:
- Es SELECT only (no muta).
- Devuelve solo dominios verificados activos (públicos por design — son los hostnames servidos).
- No leak de datos: el visitante anónimo del custom domain ya CONOCE el host (lo escribió en la URL).

Cualquier OTRO consumer de `place_domain` desde código de feature usa la policy owner-only normal. **Si una página o handler nuevo necesita leer `place_domain` sin sesión owner, primero discutir si justifica un DEFINER nuevo (ADR) o si la query no es necesaria.**

## Tests pertinentes

`src/db/__tests__/rls-place-domain.test.ts` (18 tests):

- **S1 (3 tests)** — ADR-0026 partial unique post-archive (re-registro post-soft-delete OK).
- **S2 (2 tests)** — INSERT owner baseline + INSERT non-owner DENIED.
- **S3 (2 tests)** — SELECT non-owner → 0 filas + SELECT miembro → 0 filas (member-read NO extiende).
- **S4 (6 tests)** — Matriz UPDATE/DELETE × {non-owner, miembro} → 0 filas; controles positivos owner UPDATE/DELETE → 1 fila.
- **S5 (1 test)** — Cross-place scoping: owner de place X no ve/muta place_domain de place A.
- **S6 (2 tests)** — Anti-refactor edges: owner conserva acceso a archived_at NOT NULL (audit trail) + a place.archived_at NOT NULL (tombstone). Si un refactor agrega `AND archived_at IS NULL` al predicado, estos tests rompen.
- **S7 (2 tests)** — Structural drift defense via `pg_policies` (FOR ALL + USING == WITH CHECK + cuerpo del predicado) y `pg_roles` (`app_system.rolbypassrls = false`).

Corren bajo el rol real `app_system` (NO BYPASSRLS) con claims inyectados — nunca el rol admin (falso verde por bypass).

## Pointers

- **ADR canónica owner-only set**: `docs/decisions/0012-creacion-place-via-funcion-definer.md` §2 (enumera `place_domain` 5 veces en el conjunto owner-only).
- **ADR base RLS por-operación**: `docs/decisions/0010-rls-por-operacion-invitacion-token-link.md`.
- **ADR partial unique post-archive**: `docs/decisions/0026-custom-domain-v1-lazy-verification.md` (origen de los 3 tests S1).
- **ADR member-read pattern (NO aplica a place_domain)**: `docs/decisions/0021-rls-member-read-pattern.md`.
- **SECURITY DEFINER lookup público**: `src/db/migrations/0009_lookup_place_by_domain.sql` + `docs/decisions/0031-custom-domain-routing-v1.md`.
- **Schema Drizzle del predicado**: `src/db/schema/index.ts:41-45` (helper `ownerOnly`) + `:142-168` (tabla + policy).
- **Migration SQL canónica**: `src/db/migrations/0001_round_forge.sql:39-45`.
- **Helpers de test**: `src/db/__tests__/db-test-pool.ts` (`inRlsTx`, `tx.as`, `tx.q`, `tx.denied`).
