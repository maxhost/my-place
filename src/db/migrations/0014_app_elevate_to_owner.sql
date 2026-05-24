-- Feature D · S2 (ADR-0035 §Decisión 2 CU2, 2026-05-24) — primer mutador
-- DEFINER post-WORM-via-DEFINER refactor de S1. Canaliza la única vía de
-- promover un miembro activo a co-owner del place. Post-S1 los
-- INSERT/UPDATE/DELETE directos sobre `place_ownership` están REVOKE a
-- `app_system` → toda mutación pasa por las 4 funciones DEFINER
-- (`app.create_place` S0/0002 refinada en 0013, `app.elevate_to_owner` S2/
-- 0014, `app.revoke_ownership` S3/0015, `app.transfer_founder_ownership`
-- S4/0016).
--
-- ## Pre-conditions in body (5)
--
-- Validadas en el cuerpo en orden tal que el primer fail relevante manda
-- (defense-in-depth + diagnóstico claro):
--
--   1. **caller autenticado**: `app.current_user_id() IS NOT NULL`. Falla
--      con `28000 invalid_authorization_specification` (mismo patrón que
--      `app.create_place`). El message en español por compat con la base
--      de funciones DEFINER existentes (el wrapper TS V1.1 discrimina por
--      code, no por message).
--   2. **app_user existe para el caller**: lookup `app_user WHERE auth_user_id =
--      caller_claim`. Falla con `P0002` (compat con `app.create_place`) si
--      no hay fila (caso edge: claim válido pero `ensureAppUser` no corrió;
--      no esperado en runtime normal).
--   3. **place exists**: lookup `place WHERE id = p_place_id`. Falla con
--      `P0001 place not found` ANTES de evaluar ownership (evita filtrar
--      por error la existencia del place vía un message ambiguo "caller is
--      not an owner" sobre un id que ni existe).
--   4. **caller is owner of place**: `EXISTS (place_ownership WHERE
--      place_id = p_place_id AND user_id = caller.user_id)`. Falla con
--      `P0001 caller is not an owner of this place`. Privilege escalation
--      guard primario.
--   5. **target NOT already owner**: `EXISTS (place_ownership WHERE
--      place_id = p_place_id AND user_id = p_to_user_id)` → si true falla
--      con `P0001 target is already an owner`. Chequeado ANTES de "active
--      member" para que el caso self-promote (target=caller, alice
--      promoviendo a alice) caiga acá sin path especial — alice ya es
--      owner por construcción, no necesita check separado.
--   6. **target IS active member**: `EXISTS (membership WHERE place_id =
--      p_place_id AND user_id = p_to_user_id AND left_at IS NULL)`. Falla
--      con `P0001 target is not an active member`. Cubre dos paths: target
--      sin fila en `membership` (nunca fue miembro) y target con fila pero
--      `left_at NOT NULL` (ex-miembro, cerrado). Misma pre-condition,
--      distinto path — la negativa cubre ambos.
--
-- ## Por qué el orden de las pre-conditions importa
--
-- Spec §S2 lista 8 tests; cada uno espera un mensaje específico. Mover una
-- check del lugar correcto haría que el caso "place inexistente" reporte
-- "caller is not an owner" (info leak: el caller deduce que la check de
-- ownership corre antes que la existence check → puede sondear ids
-- válidos por diferencia de mensajes). El orden actual es coherente con la
-- semántica "primero estructural, después de autorización, último
-- aplicación":
--
--   1-2 → estructura del schema (auth + app_user lookup)
--   3   → existencia del recurso (place)
--   4   → autorización del caller sobre el recurso
--   5-6 → invariantes de aplicación sobre el target
--
-- ## Defensa anti-race del INSERT
--
-- El test concurrent "dos callers elevan al mismo target simultáneamente"
-- queda cubierto por el UNIQUE constraint (user_id, place_id) heredado de
-- la migration 0001:46 — el segundo INSERT falla con `23505`. Esto NO
-- amerita ON CONFLICT DO NOTHING acá: queremos que el segundo caller vea
-- el error (no silent success), y la duplicate violation es informativa
-- explícita. El UI futuro puede mapear `23505` a "already an owner (race)"
-- si necesario.
--
-- ## Idempotencia bajo CREATE OR REPLACE
--
-- Drizzle re-aplica migrations en cada branch test fresh. CREATE OR
-- REPLACE preserva la signature; los REVOKE/GRANT post-CREATE son
-- idempotentes. Sin DROP previo (no necesario; ningún otro objeto depende
-- de la signature `(text, text)`).
--
-- ## Reverse SQL (rollback puntual)
--
-- Idempotente; aplicable si la migration corrió en una branch test y se
-- requiere volver al estado pre-S2. No automatizable por drizzle-kit (no
-- soporta `down`). Manual:
--
--   REVOKE EXECUTE ON FUNCTION app.elevate_to_owner(text, text) FROM "app_system";
--   DROP FUNCTION IF EXISTS app.elevate_to_owner(text, text);
--
-- Sin caveats: la función es self-contained. Post-rollback, cualquier
-- intento de invocarla falla con `42883 undefined_function` (mismo estado
-- pre-migración).

CREATE OR REPLACE FUNCTION app.elevate_to_owner(p_to_user_id text, p_place_id text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth   text := app.current_user_id();
  v_caller text;
BEGIN
  -- Pre-condition 1: caller autenticado.
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'no autenticado' USING errcode = '28000';
  END IF;

  -- Pre-condition 2: app_user existe para el caller. Edge case (claim
  -- válido pero sin app_user) — `ensureAppUser` debería haber corrido en
  -- signup; el guard P0002 mantiene la simetría con `app.create_place`.
  SELECT id INTO v_caller FROM app_user WHERE auth_user_id = v_auth;
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'app_user inexistente para el caller' USING errcode = 'P0002';
  END IF;

  -- Pre-condition 3: place exists. Antes de ownership check para no filtrar
  -- existencia del id vía diferencia de mensajes (info leak).
  IF NOT EXISTS (SELECT 1 FROM place WHERE id = p_place_id) THEN
    RAISE EXCEPTION 'place not found' USING errcode = 'P0001';
  END IF;

  -- Pre-condition 4: caller is owner of place. Privilege escalation guard.
  IF NOT EXISTS (
    SELECT 1 FROM place_ownership
    WHERE place_id = p_place_id AND user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'caller is not an owner of this place' USING errcode = 'P0001';
  END IF;

  -- Pre-condition 5: target NOT already owner. ANTES de active member check
  -- para que self-promote (caller=target) caiga acá sin path especial.
  IF EXISTS (
    SELECT 1 FROM place_ownership
    WHERE place_id = p_place_id AND user_id = p_to_user_id
  ) THEN
    RAISE EXCEPTION 'target is already an owner' USING errcode = 'P0001';
  END IF;

  -- Pre-condition 6: target IS active member (membership con left_at NULL).
  -- Cubre 2 paths: target sin fila + target con fila left_at NOT NULL.
  IF NOT EXISTS (
    SELECT 1 FROM membership
    WHERE place_id = p_place_id
      AND user_id = p_to_user_id
      AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'target is not an active member' USING errcode = 'P0001';
  END IF;

  -- All pre-conditions satisfied: INSERT ownership row. `granted_at` toma
  -- su DEFAULT now() (schema 0001). Race del UNIQUE constraint (otro caller
  -- inserta entre nuestra check #5 y este INSERT) lanza 23505 — visible al
  -- caller, no silent.
  INSERT INTO place_ownership (user_id, place_id) VALUES (p_to_user_id, p_place_id);
END;
$$;--> statement-breakpoint

-- ACL: EXECUTE sólo a `app_system` (rol runtime), denegado a PUBLIC.
-- Idempotente bajo CREATE OR REPLACE (grants preservados).
REVOKE EXECUTE ON FUNCTION app.elevate_to_owner(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.elevate_to_owner(text, text) TO "app_system";
