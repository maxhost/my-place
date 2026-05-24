# `place_ownership` multi-owner V1 — Spec

> _Spec creado 2026-05-24 (S0 de Feature D). Status: planificación. Decisión canónica en [ADR-0035](../../decisions/0035-place-ownership-multi-owner-v1.md). Plan operativo en [`./plan-sesiones.md`](./plan-sesiones.md). Tests TDD checklist en [`./tests.md`](./tests.md). Baseline pre-implementación: `baseline/pre-feature-d` = `aaf238b`._

## Contexto

Auditoría RLS post-hardening de `place_domain` (2026-05-23) detectó tres asimetrías estructurales en `place_ownership` que el schema actual permite y la app NO defendía con gates DB: policies SELF en lugar de OWNER-OF-PLACE, `po_upd` sin `WITH CHECK`, y cero enforcement del invariante "mínimo 1 owner por place activo" en el motor (sólo doc). Detalle completo en ADR-0035 §Contexto.

Feature D V1 cierra ese gap **estructuralmente** y a la vez canoniza tres extensiones conceptuales que las decisiones previas (ADR-0002 §1, ADR-0003 §1, ADR-0012 §2 y §3) no abordaban explícitamente: multi-owner desde V1, founder slot único + no-delete por otro owner, y transferencia 1:1 del founder slot.

V1 se acota a **DB + RLS + docs**: no hay UI nueva, no hay Server Actions nuevas, no hay wrappers TS nuevos, no hay i18n nuevo. Las 4 funciones `SECURITY DEFINER` que canalizan toda mutación quedan estables y testeadas; los consumers (UI de "invitar co-owner" / "revocar owner" / "transferir founder") se construyen en V1.1+ sobre la primitive ya sólida sin re-arquitectura. Patrón ya canónico del proyecto: ADR-0012 §3 (`app.create_place`) + ADR-0032 §6 (`app.consume_sso_jti`).

## Modelo conceptual

ADR-0035 §Decisión define los tres conceptos que el motor debe representar y enforcear:

**Multi-owner como invariante estructural.** Un place tiene N owners simultáneos (N≥1), representados como N filas en `place_ownership` con el mismo `place_id`. Todos los owners comparten el mismo poder operativo CRUD sobre el place (las policies de `place`/`membership`/`invitation`/`place_domain` ya en producción no cambian; siguen siendo "owner-only" en el sentido derivado vía `place_ownership`). La novedad estructural es que N filas con el mismo `place_id` son válidas y deseadas — el schema previo lo permitía sin documentarlo y sin defender el caso.

**Founder slot único + no-delete.** El creador del place ocupa un slot único representado por la nueva columna `place.founder_user_id` (text NOT NULL post back-fill). El founder NO puede ser revocado por otro owner — la única vía de cambio es transferencia 1:1, no remoción directa. Esto cierra de raíz el caso patológico "el último owner queda removido y el place quedó huérfano": la función `revoke_ownership` rechaza estructuralmente cualquier intento de borrar la fila `place_ownership` del founder.

**Asimetría operacional explícita.** Todos los owners (founder + co-owners) tienen idéntico poder CRUD sobre el place. La asimetría se limita a **dos campos y a la mecánica de remoción**: el founder tiene un slot inmutable salvo transferencia; los co-owners se pueden revocar entre sí (cualquiera de ellos puede revocar a otro co-owner, jamás al founder). Auto-revoke (un owner se quita a sí mismo sin transferir) NO entra en V1 — diferido a V1.1+ con un futuro `step_down_as_owner` (gap consciente, §Gaps conscientes V1).

**Remoción de owner ≠ expulsión del place.** Cuando un owner es revocado, sólo la fila `place_ownership` se elimina; la `membership` del ex-owner se preserva. Queda como miembro activo del place sin permisos owner. Salida del place es operación separada (`membership.left_at`).

Cita literal de ADR-0035 §Decisión 1: "N filas de `place_ownership` con el mismo `place_id` son válidas y deseadas".

## Casos de uso V1

V1 expone **4 casos de uso atómicos**, uno por función `SECURITY DEFINER`. Cada caso lista precondición, postcondición y los errores estructurales que la función `RAISE EXCEPTION` desde el cuerpo (mapeados a códigos PG estándar — `28000` no autenticado, `P0001` invariante violado por la app).

### CU1 — Crear place (founder automático)

Función: `app.create_place(p_slug text, p_name text, ...)` — **ya existente** desde ADR-0012 §3; se refina en S5 para incluir `INSERT INTO place (..., founder_user_id) VALUES (..., v_uid)` donde `v_uid` es el `app_user.id` del caller (extraído de `app.current_user_id()`).

- **Precondición**: caller autenticado (`app.current_user_id() IS NOT NULL`); slug disponible (unicidad ya enforced).
- **Postcondición**: nueva fila `place` con `founder_user_id = caller.user_id`; nueva fila `place_ownership` con `place_id` + `user_id = caller.user_id`; nueva fila `membership` del caller.
- **Errores estructurales**: los ya documentados por `create_place` (slug duplicado, claim faltante). S5 sólo agrega el set automático de `founder_user_id` — sin nuevos errores.

### CU2 — Elevar miembro a co-owner

Función: `app.elevate_to_owner(p_to_user_id text, p_place_id text) RETURNS void`.

- **Precondición**: caller autenticado; caller es owner actual del place (vía `app.current_user_owns_place(p_place_id) = true`); target tiene `membership` activa (`membership.left_at IS NULL`) en el mismo place; target NO es ya owner del place.
- **Postcondición**: INSERT fila en `place_ownership (place_id, user_id, granted_at = now())`. La `membership` del target NO se toca.
- **Errores estructurales**: `28000` si caller sin sesión; `P0001 caller is not an owner of this place` si no-owner; `P0001 target is not an active member` si target no es miembro o tiene `left_at NOT NULL`; `P0001 target is already an owner` si la fila ya existe; `P0001 place not found` si el `p_place_id` no existe.

### CU3 — Revocar co-owner

Función: `app.revoke_ownership(p_target_user_id text, p_place_id text) RETURNS void`.

- **Precondición**: caller autenticado; caller es owner del place; target NO es el `place.founder_user_id` (founder no-delete por otro owner); target NO es el caller (auto-revoke bloqueado V1); target es owner actual; defense-in-depth secundario: `count(owners) > 1` antes del DELETE.
- **Postcondición**: DELETE fila `place_ownership` del target. La `membership` del target se preserva intacta (ex-owner queda como miembro activo). El place archived ES revocable (mantenimiento documentado §Decisión operativa).
- **Errores estructurales**: `28000` si caller sin sesión; `P0001 caller is not an owner of this place`; `P0001 cannot revoke founder ownership` (target es founder); `P0001 cannot self-revoke ownership; use transfer or future step-down` (target = caller); `P0001 target is not an owner of this place`; `P0001 cannot revoke the only remaining owner` (defense-in-depth, no debería ocurrir post founder-check pero se valida explícito por resistencia a cambios futuros del modelo).

### CU4 — Transferir founder

Función: `app.transfer_founder_ownership(p_to_user_id text, p_place_id text) RETURNS void`.

- **Precondición**: caller autenticado; caller es el `place.founder_user_id` actual (sólo founder transfiere); target es owner actual del place (no es el caller — transferir a sí mismo no tiene sentido). Implícitamente: `count(owners) ≥ 2` antes del transfer (target ya owner ⇒ N≥2).
- **Postcondición** (en una sola transacción atómica): `UPDATE place SET founder_user_id = p_to_user_id WHERE id = p_place_id` + `DELETE FROM place_ownership WHERE place_id = p_place_id AND user_id = caller.user_id`. Caller pierde ownership (queda como miembro); target asume founder slot. La `membership` del caller se preserva.
- **Errores estructurales**: `28000` si caller sin sesión; `P0001 caller is not the founder of this place`; `P0001 target is not an owner; elevate first` (transfer requiere target owner pre-existente — refuerzo del "no transfer-without-successor", ADR-0035 §Alternativas rechazadas); `P0001 cannot transfer to self`; `P0001 place not found`.

Estos 4 casos cubren V1 entero. El wrapper TS futuro mapeará cada `RAISE EXCEPTION` al tipo de error de dominio correspondiente (`ElevateError`/`RevokeError`/`TransferError`); V1 no incluye wrapper — el caller es el test SQL directo, y V1.1+ construye los wrappers sobre la primitive estable.

## Schema delta

Sólo dos cambios estructurales relevantes en S1 (migration 0012):

1. **`place.founder_user_id text NOT NULL`** (post back-fill). Referencia lógica a `app_user.id`, sin FK hard — mismo criterio que `app_user.auth_user_id → neon_auth.user.id` (ADR-0006). Back-fill determinístico: `UPDATE place p SET founder_user_id = (SELECT po.user_id FROM place_ownership po WHERE po.place_id = p.id ORDER BY po.granted_at ASC LIMIT 1)`. Idempotente por construcción. Tras el back-fill: `ALTER COLUMN founder_user_id SET NOT NULL`.

2. **Refactor RLS `place_ownership`**: DROP de `po_sel` / `po_upd` / `po_del` (las 3 policies SELF actuales) + CREATE única `po_sel USING (app.current_user_owns_place(place_id))` + REVOKE INSERT/UPDATE/DELETE explícito a `app_system` (defense-in-depth — mismo patrón `place`/`membership` de ADR-0012 §1). Sin nuevas columnas en `place_ownership`; sólo refactor de policies.

Sin cambios en `place_ownership` columnas (`place_id`/`user_id`/`granted_at` se preservan). Sin cambios en `membership`/`app_user`/`invitation`. La feature es 100% schema + RLS + funciones DEFINER + back-fill.

## Funciones DEFINER (interfaz)

Las 4 funciones canalizan toda mutación de `place_ownership` y toda mutación de `place.founder_user_id`. Todas con `LANGUAGE plpgsql` (excepto el helper SQL), `SECURITY DEFINER`, `SET search_path = public, pg_temp` (anti-hijack), `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO "app_system"`. Cuerpo valida invariantes y emite `RAISE EXCEPTION` estructural.

```sql
-- Helper (S1, migration 0012) — usado por po_sel y por las otras 3 funciones
CREATE OR REPLACE FUNCTION app.current_user_owns_place(p_place_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM place_ownership po
    JOIN app_user au ON au.id = po.user_id
    WHERE po.place_id = p_place_id
      AND au.auth_user_id = (select app.current_user_id())
  );
$$;

-- S2, migration 0013
CREATE OR REPLACE FUNCTION app.elevate_to_owner(p_to_user_id text, p_place_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
-- pre-conditions in body: caller owns place; target has active membership;
-- target not already owner; place exists.

-- S3, migration 0014
CREATE OR REPLACE FUNCTION app.revoke_ownership(p_target_user_id text, p_place_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
-- pre-conditions in body: caller owns place; target is owner; target != founder;
-- target != caller (no self-revoke V1); count(owners) > 1 (defense-in-depth).

-- S4, migration 0015
CREATE OR REPLACE FUNCTION app.transfer_founder_ownership(p_to_user_id text, p_place_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
-- pre-conditions in body: caller == place.founder_user_id; target is owner;
-- target != caller; place exists. Atomic: UPDATE founder + DELETE caller-ownership.
```

**Códigos de error canónicos emitidos** (cruzados con los tests S2-S4):

| Code | Trigger | Función |
|---|---|---|
| `28000` (`invalid_authorization_specification`) | `app.current_user_id() IS NULL` | las 3 mutadoras |
| `P0001` (`raise_exception`) | invariante violado por el caller | las 3 mutadoras |

El mapeo `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '...'` es uniforme; el wrapper TS V1.1 discriminará por el `MESSAGE` (string match) o por un futuro `DETAIL` estructurado JSON — decisión deferida al diseño del wrapper.

## Gaps conscientes V1

V1 acota deliberadamente para shipear la primitive sólida. Cada uno de los siguientes se difiere a V1.1+ con razón explícita:

- **Wrappers TS** (`app.elevate_to_owner` / `revoke_ownership` / `transfer_founder_ownership`). V1 = SQL directo desde tests. V1.1 wraps con type-safe error mapping cuando entre el UI consumer.
- **UI** (sección "Co-owners" del settings: lista + invitar + revocar + transferir). V1.1+, sobre la primitive DEFINER ya estable.
- **Server Actions** (`elevateToOwnerAction`/`revokeOwnershipAction`/`transferFounderAction`). V1.1+ con autorización + form parsing + revalidación de paths.
- **i18n** del bloque `placeSettings.coOwners.*` × 6 locales. V1.1+ con la UI.
- **Invitation flow específico para co-owner**. V1 asume que el target ya es miembro (precondición de `elevate_to_owner`). V1.1+ podría añadir un flow `invite + elevate` atómico si la UX lo demanda; por ahora son dos operaciones separadas (invitar via flow existente ADR-0010 §2 + elevar después).
- **Auto-revoke** (`app.step_down_as_owner` — un owner se quita a sí mismo sin transferir). V1 rechaza explícitamente (un owner que quiere renunciar debe coordinar con otro owner que lo revoque, o si es founder, transferir antes). V1.1+ si el caso aparece en producción.
- **Historial/auditoría de transfers** (tabla `place_ownership_transfer_log` o similar). V1 no la mantiene; los DELETE/INSERT de las funciones DEFINER no dejan trail más allá de PG WAL. V1.1+ si compliance lo requiere.
- **Notificación al ex-owner revocado** (email/in-app "fuiste removido como owner de {place}"). V1 no notifica. V1.1+ con el canal de notifs.

Cada gap queda explícito acá para que la sesión que los aborde post-V1 sepa qué encontrar y qué NO encontrar en el schema actual.

## Decisión operativa: place archived es revocable y transferible

Cita literal ADR-0035 §Decisión 2: la función `revoke_ownership` NO discrimina por `place.subscription_status`. Razón: mantenimiento de places archivados (un owner puede querer transferir ownership de un place inactivo a otro user antes de purga física, o un co-owner remover ownership obsoleta tras archive). Misma decisión para `transfer_founder_ownership`. Sin gating por status del place — la única discriminación es la del invariante "founder no-delete + N≥2 antes de revoke". Tests S3-S4 cubren explícitamente el caso `place archived → operación permitida`.

## Smoke verification

Tras S6 (cierre operativo del slice), la verificación manual incluye correr las 4 funciones DEFINER end-to-end contra un Neon test branch con `psql` directo (script ad-hoc, no committed). Setup:

1. Crear 3 `app_user` distintos (alice, bob, carol) + 1 place creado por alice (CU1).
2. Como alice (owner único + founder), llamar `app.elevate_to_owner('bob_user_id', '<place_id>')` → assert nueva fila `place_ownership`; llamar de nuevo → assert `P0001 target is already an owner`.
3. Como bob (ahora owner), llamar `app.revoke_ownership('alice_user_id', '<place_id>')` → assert `P0001 cannot revoke founder ownership`. Llamar `app.revoke_ownership('bob_user_id', '<place_id>')` (auto-revoke) → assert `P0001 cannot self-revoke`.
4. Como alice (founder), `app.transfer_founder_ownership('bob_user_id', '<place_id>')` → assert `place.founder_user_id = bob_user_id` + fila `place_ownership` de alice eliminada + `membership` de alice intacta.
5. INSERT direct a `place_ownership` desde código de feature (simulando un drift) → assert `ERROR: permission denied for table place_ownership` (regression del REVOKE).

Resultados se logean en S6 (mismo patrón que el smoke `dpl_*` de Feature C); si algún assert falla, S6 no cierra y se abre debugging session.

## Pointers

- **ADR canónica V1 de Feature D**: [`../../decisions/0035-place-ownership-multi-owner-v1.md`](../../decisions/0035-place-ownership-multi-owner-v1.md).
- **Precedente WORM-via-DEFINER**: [`../../decisions/0012-creacion-place-via-funcion-definer.md`](../../decisions/0012-creacion-place-via-funcion-definer.md) §3 (`app.create_place`).
- **Precedente `SECURITY DEFINER` + consume + GC oportunista**: [`../../decisions/0032-custom-domain-sso-signed-ticket.md`](../../decisions/0032-custom-domain-sso-signed-ticket.md) §6 (`app.consume_sso_jti`).
- **Schema base + invariantes del dominio** (post-S5): [`../../data-model.md`](../../data-model.md) (sección `place` y `place_ownership` actualizadas con `founder_user_id` + nuevo invariante DB-enforced).
- **RLS por-operación** (post-S1): [`../../multi-tenancy.md`](../../multi-tenancy.md) § RLS, bullet `place_ownership` reescrito con helper DEFINER + denial INSERT/UPDATE/DELETE.
- **Plan de sesiones operativo**: [`./plan-sesiones.md`](./plan-sesiones.md).
- **Test checklist por sesión**: [`./tests.md`](./tests.md).
