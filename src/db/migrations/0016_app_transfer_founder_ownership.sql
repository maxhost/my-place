-- Feature D · S4 (ADR-0035 §Decisión 2 CU4, 2026-05-24) — tercer mutador
-- DEFINER. Canaliza la única vía de transferir el founder slot 1:1: cambia
-- `place.founder_user_id` al target Y elimina la fila `place_ownership` del
-- caller en la misma tx implícita del plpgsql body (operación compuesta atómica
-- por construcción — sin COMMIT intermedios ni savepoints en el cuerpo).
--
-- Modelo conceptual (ADR-0035 §Decisión 1): founder slot único + inmutable
-- salvo transferencia. CU4 es la ÚNICA vía de cambio del founder. El target
-- debe ser owner pre-existente (no transfer-without-successor — refuerzo del
-- invariante "nunca un place sin founder"). Tras la transferencia: el caller
-- pierde su ownership pero conserva su membership (revoke ≠ expulsión, spec
-- §"Remoción de owner ≠ expulsión del place").
--
-- ## Pre-conditions in body (6)
--
-- Validadas en el cuerpo en orden tal que el primer fail relevante manda:
--
--   1. **caller autenticado**: `app.current_user_id() IS NOT NULL`. Falla
--      con `28000 invalid_authorization_specification` (mismo patrón que las
--      otras 3 DEFINER de Feature D). Message en español por compat con la
--      base existente (el wrapper TS V1.1+ discrimina por code, no message).
--   2. **app_user existe para el caller**: lookup `app_user WHERE auth_user_id =
--      caller_claim`. Falla con `P0002` si no hay fila (edge: claim válido sin
--      app_user, no esperado runtime normal).
--   3. **place exists**: `SELECT founder_user_id INTO v_founder FROM place
--      WHERE id = p_place_id`. Tras 0012, `founder_user_id` es NOT NULL, así
--      que `v_founder IS NULL` post-SELECT implica que NO existe la fila →
--      `P0001 place not found`. Antes del check de caller-founder (evita
--      mensaje ambiguo "caller is not the founder" sobre un id inexistente).
--   4. **caller == place.founder_user_id**: `v_caller = v_founder`. Falla
--      con `P0001 caller is not the founder of this place`. Asimetría founder
--      explícita (ADR-0035 §Decisión 1 — sólo founder transfiere; co-owners
--      no pueden transferir el slot). Captura cross-place naturalmente: si
--      alice es founder de place-a y trata de transferir en place-other,
--      v_founder = founder de place-other ≠ alice → rechazo.
--   5. **target is owner of place**: `EXISTS (place_ownership WHERE place_id =
--      p_place_id AND user_id = p_to_user_id)`. Falla con `P0001 target is
--      not an owner; elevate first`. Refuerza "no transfer-without-successor":
--      target debe ser owner pre-existente (si no, el caller debe elevar
--      primero — operación separada CU2). Captura el caso N=1 founder solo
--      naturalmente (place con sólo el founder → cualquier target distinto
--      del founder NO es owner → rechazo).
--   6. **target ≠ caller** (no self-transfer): `p_to_user_id ≠ v_caller`.
--      Falla con `P0001 cannot transfer to self`. Trivial no-op bloqueado
--      explícito. Chequeado DESPUÉS de target=owner para preservar el mensaje
--      canónico "elevate first" cuando aplique; alice→alice (founder+owner)
--      pasa target=owner check, falla acá.
--
-- ## Por qué el orden importa
--
--   1-2 → estructura del schema (auth + app_user lookup).
--   3   → existencia del recurso (place) — evita info-leak via "caller is not founder" sobre id inexistente.
--   4   → autorización del caller (founder slot).
--   5   → validez estructural del target (owner pre-existente).
--   6   → invariante no-self-transfer (último, después de validar target válido).
--
-- ## Atomicidad de UPDATE + DELETE
--
-- El cuerpo plpgsql ES una sola transacción implícita: UPDATE place +
-- DELETE place_ownership corren bajo el mismo snapshot, sin COMMIT intermedio.
-- Si cualquier statement falla post-checks (race con otra tx, constraint), el
-- RAISE EXCEPTION desde el cuerpo aborta ambos. No hay path en el que UPDATE
-- aplique pero DELETE no (o viceversa). El test T9 fija este contract
-- observable; PG-side no se puede forzar fail mid-body sin trigger custom,
-- pero el invariante queda documentado.
--
-- ## `archived_at` del place NO bloquea transfer
--
-- Decisión operativa §spec ADR-0035 (misma que CU3): mantenimiento de places
-- archivados permitido. La función NO consulta `place.subscription_status` ni
-- `place.archived_at`. Test T8 lo cubre explícito. Defensa contra refactor
-- futuro que agregue gating por status del place.
--
-- ## Membership del caller preservada
--
-- Spec §"Remoción de owner ≠ expulsión del place": tras transfer, sólo la fila
-- `place_ownership` del caller se elimina; su `membership` queda intacta. El
-- ex-founder queda como miembro activo del place sin permisos owner. Salida
-- del place es operación separada (`membership.left_at`). Tests T1/T10 lo
-- asseretan.
--
-- ## Idempotencia bajo CREATE OR REPLACE
--
-- Drizzle re-aplica migrations en cada branch test fresh. CREATE OR REPLACE
-- preserva la signature; REVOKE/GRANT post-CREATE son idempotentes. Sin DROP
-- previo (ningún otro objeto depende de la signature `(text, text)`).
--
-- ## Reverse SQL (rollback puntual)
--
-- Idempotente; aplicable si la migration corrió en branch test y se requiere
-- volver al estado pre-S4. No automatizable por drizzle-kit (no soporta
-- `down`). Manual:
--
--   REVOKE EXECUTE ON FUNCTION app.transfer_founder_ownership(text, text) FROM "app_system";
--   DROP FUNCTION IF EXISTS app.transfer_founder_ownership(text, text);
--
-- Sin caveats: la función es self-contained. Post-rollback, cualquier intento
-- de invocarla falla con `42883 undefined_function` (estado pre-migración).

CREATE OR REPLACE FUNCTION app.transfer_founder_ownership(p_to_user_id text, p_place_id text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth    text := app.current_user_id();
  v_caller  text;
  v_founder text;
BEGIN
  -- Pre-condition 1: caller autenticado.
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'no autenticado' USING errcode = '28000';
  END IF;

  -- Pre-condition 2: app_user existe para el caller.
  SELECT id INTO v_caller FROM app_user WHERE auth_user_id = v_auth;
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'app_user inexistente para el caller' USING errcode = 'P0002';
  END IF;

  -- Pre-condition 3: place exists. Post-0012 founder_user_id es NOT NULL en
  -- el schema, así que v_founder IS NULL post-SELECT implica que no hay fila.
  -- Antes de caller=founder check para no filtrar existencia del id vía
  -- diferencia de mensajes (info leak).
  SELECT founder_user_id INTO v_founder FROM place WHERE id = p_place_id;
  IF v_founder IS NULL THEN
    RAISE EXCEPTION 'place not found' USING errcode = 'P0001';
  END IF;

  -- Pre-condition 4: caller == place.founder_user_id. Asimetría founder
  -- explícita: sólo founder transfiere. Captura cross-place naturalmente.
  IF v_caller <> v_founder THEN
    RAISE EXCEPTION 'caller is not the founder of this place' USING errcode = 'P0001';
  END IF;

  -- Pre-condition 5: target is owner of place. Refuerza no-transfer-without-
  -- successor — target debe ser owner pre-existente (elevar primero si no).
  -- Captura el caso N=1 founder solo naturalmente (target ≠ founder → not owner).
  IF NOT EXISTS (
    SELECT 1 FROM place_ownership
    WHERE place_id = p_place_id AND user_id = p_to_user_id
  ) THEN
    RAISE EXCEPTION 'target is not an owner; elevate first' USING errcode = 'P0001';
  END IF;

  -- Pre-condition 6: target ≠ caller (no self-transfer). Trivial no-op bloqueado
  -- explícito. Después de target=owner para preservar el mensaje canónico
  -- "elevate first" cuando aplique.
  IF p_to_user_id = v_caller THEN
    RAISE EXCEPTION 'cannot transfer to self' USING errcode = 'P0001';
  END IF;

  -- All pre-conditions satisfied: operación compuesta atómica.
  -- UPDATE founder_user_id + DELETE caller ownership comparten el mismo
  -- snapshot tx implícito del cuerpo plpgsql (sin COMMIT intermedio).
  UPDATE place SET founder_user_id = p_to_user_id WHERE id = p_place_id;
  DELETE FROM place_ownership WHERE place_id = p_place_id AND user_id = v_caller;
END;
$$;--> statement-breakpoint

-- ACL: EXECUTE sólo a `app_system` (rol runtime), denegado a PUBLIC.
-- Idempotente bajo CREATE OR REPLACE (grants preservados).
REVOKE EXECUTE ON FUNCTION app.transfer_founder_ownership(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.transfer_founder_ownership(text, text) TO "app_system";
