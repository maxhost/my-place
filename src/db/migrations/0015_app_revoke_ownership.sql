-- Feature D · S3 (ADR-0035 §Decisión 2 CU3, 2026-05-24) — segundo mutador
-- DEFINER post-WORM-via-DEFINER refactor de S1. Canaliza el único DELETE en
-- `place_ownership`. La función con la mayor superficie de invariantes
-- (6 pre-conditions in body) de las 4 DEFINER de Feature D.
--
-- ## Pre-conditions in body (6)
--
-- Validadas en el cuerpo en orden tal que el primer fail relevante manda
-- (defense-in-depth + diagnóstico claro + anti-info-leak):
--
--   1. **caller autenticado**: `app.current_user_id() IS NOT NULL`. Falla
--      con `28000 invalid_authorization_specification` (mismo patrón que
--      `app.elevate_to_owner` y `app.create_place`). Message en español por
--      compat con la base existente (el wrapper TS V1.1+ discrimina por code).
--   2. **app_user existe para el caller**: lookup `app_user WHERE auth_user_id =
--      caller_claim`. Falla con `P0002` (compat con resto de DEFINERs) si no
--      hay fila (edge: claim válido sin app_user, no esperado runtime normal).
--   3. **caller is owner del place**: `EXISTS (place_ownership WHERE place_id =
--      p_place_id AND user_id = caller.user_id)`. Falla con `P0001 caller is
--      not an owner of this place`. Privilege escalation guard primario.
--      Captura cross-place naturalmente (p_place_id discrimina ownership en
--      ese place específico — un owner de otro place NO es owner de éste).
--      También captura place inexistente (sin fila en place_ownership → false).
--   4. **target is owner del place**: `EXISTS (place_ownership WHERE place_id =
--      p_place_id AND user_id = p_target_user_id)`. Falla con `P0001 target
--      is not an owner of this place`. Cubre: target sin ownership en el place
--      (member-only). Captura cross-place by membership por transitividad —
--      un no-miembro nunca aparece en place_ownership del place ajeno.
--   5. **target NOT founder**: `p_target_user_id ≠ place.founder_user_id`.
--      Falla con `P0001 cannot revoke founder ownership`. Founder slot único
--      + inmutable salvo `transfer_founder_ownership` (CU4). Chequeado ANTES
--      de self-revoke para que el caso patológico caller=target=founder
--      (T7 del test) caiga acá sin path especial — el founder único es ya
--      owner por construcción, no necesita check separado.
--   6. **target NOT caller** (no self-revoke V1): `p_target_user_id ≠
--      caller.user_id`. Falla con `P0001 cannot self-revoke ownership; use
--      transfer or future step-down`. V1 bloquea explícito auto-revoke
--      (decisión spec §Gaps conscientes V1: `step_down_as_owner` queda V1.1+
--      con design separado — un owner que quiere renunciar coordina con otro
--      owner que lo revoque, o si es founder, transfiere antes).
--   7. **count(owners) > 1** defense-in-depth: `count(*) FROM place_ownership
--      WHERE place_id = p_place_id`. Falla con `P0001 cannot revoke the only
--      remaining owner`. Unreachable post-#5 (si target ≠ founder y founder
--      es único, count ≥ 2 implícito), pero documentado explícito por
--      resistencia a refactors futuros del modelo (ADR-0035 §4). Si alguna
--      vez el founder slot deja de ser único, este check sigue siendo el
--      último guard estructural antes del DELETE.
--
-- ## Por qué el orden importa (anti-info-leak + invariant precedence)
--
--   1-2 → estructura del schema (auth + app_user lookup).
--   3   → autorización del caller sobre el recurso.
--   4   → validez del target sobre el recurso.
--   5   → invariante founder (ANTES de self-revoke).
--   6   → invariante self-revoke.
--   7   → defense-in-depth count (unreachable post #5 pero documentado).
--
-- Reordenarlo cambia mensajes en casos patológicos → confunde al UI consumer
-- (V1.1+) y posiblemente filtra info por diferencia de mensajes. T7 fija el
-- orden founder→self-revoke→count explícitamente con `not.toMatch` asserts.
--
-- ## `archived_at` del place NO bloquea revoke
--
-- Decisión operativa §spec ADR-0035: mantenimiento de places archivados
-- permitido (un owner puede querer transferir/revocar ownership de un place
-- inactivo antes de purga física). La función NO consulta `place.
-- subscription_status` ni `place.archived_at`. Test T9 lo cubre explícito.
-- Misma decisión para `transfer_founder_ownership` (S4).
--
-- ## Membership del target preservada
--
-- Spec §"Remoción de owner ≠ expulsión del place": cuando un owner es
-- revocado, sólo la fila `place_ownership` se elimina; la `membership` del
-- ex-owner se preserva (queda como miembro activo sin permisos owner).
-- Salida del place es operación separada (`membership.left_at`). Test T1
-- assertea `membership.left_at IS NULL` post-revoke.
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
-- volver al estado pre-S3. No automatizable por drizzle-kit (no soporta
-- `down`). Manual:
--
--   REVOKE EXECUTE ON FUNCTION app.revoke_ownership(text, text) FROM "app_system";
--   DROP FUNCTION IF EXISTS app.revoke_ownership(text, text);
--
-- Sin caveats: la función es self-contained. Post-rollback, cualquier intento
-- de invocarla falla con `42883 undefined_function` (estado pre-migración).

CREATE OR REPLACE FUNCTION app.revoke_ownership(p_target_user_id text, p_place_id text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth    text := app.current_user_id();
  v_caller  text;
  v_founder text;
  v_count   int;
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

  -- Pre-condition 3: caller is owner del place. Privilege escalation guard.
  -- Captura cross-place y place inexistente por construcción.
  IF NOT EXISTS (
    SELECT 1 FROM place_ownership
    WHERE place_id = p_place_id AND user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'caller is not an owner of this place' USING errcode = 'P0001';
  END IF;

  -- Pre-condition 4: target is owner del place. Captura no-miembro by
  -- transitividad (un no-miembro nunca aparece en place_ownership).
  IF NOT EXISTS (
    SELECT 1 FROM place_ownership
    WHERE place_id = p_place_id AND user_id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'target is not an owner of this place' USING errcode = 'P0001';
  END IF;

  -- Pre-condition 5: target NOT founder. ANTES de self-revoke para que el
  -- caso patológico caller=target=founder (T7) caiga acá. El SELECT del
  -- founder es seguro: place existe por construcción (pre-condition 3 falló
  -- ya si el place no existe — caller_owner check imposible sin place row).
  SELECT founder_user_id INTO v_founder FROM place WHERE id = p_place_id;
  IF p_target_user_id = v_founder THEN
    RAISE EXCEPTION 'cannot revoke founder ownership' USING errcode = 'P0001';
  END IF;

  -- Pre-condition 6: target NOT caller (no self-revoke V1).
  IF p_target_user_id = v_caller THEN
    RAISE EXCEPTION 'cannot self-revoke ownership; use transfer or future step-down'
      USING errcode = 'P0001';
  END IF;

  -- Pre-condition 7: count(owners) > 1 defense-in-depth. Unreachable post-#5
  -- (founder único → si target ≠ founder hay al menos 2 owners) pero
  -- documentado explícito por resistencia a refactors futuros del modelo.
  SELECT count(*) INTO v_count FROM place_ownership WHERE place_id = p_place_id;
  IF v_count <= 1 THEN
    RAISE EXCEPTION 'cannot revoke the only remaining owner' USING errcode = 'P0001';
  END IF;

  -- All pre-conditions satisfied: DELETE place_ownership row del target.
  -- La `membership` del target NO se toca (preservada por invariante: spec
  -- §"Remoción de owner ≠ expulsión del place"). Salida del place es
  -- operación separada vía `membership.left_at`.
  DELETE FROM place_ownership WHERE place_id = p_place_id AND user_id = p_target_user_id;
END;
$$;--> statement-breakpoint

-- ACL: EXECUTE sólo a `app_system` (rol runtime), denegado a PUBLIC.
-- Idempotente bajo CREATE OR REPLACE (grants preservados).
REVOKE EXECUTE ON FUNCTION app.revoke_ownership(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.revoke_ownership(text, text) TO "app_system";
