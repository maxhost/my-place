-- Feature E · S4 (spec §CU4, 2026-05-24) — 3er mutador DEFINER del slice
-- members. Canaliza el soft-remove de un miembro vía UPDATE
-- `membership.left_at = now()` (preserva fila + historial joined_at). Separa
-- concerns con `app.revoke_ownership` (Feature D, migration 0015): para
-- expulsar a un owner, el path correcto es revoke_ownership PRIMERO (deja
-- membership intacta) + remove_member DESPUÉS si se quiere expulsión total.
-- Bloquea self-remove V1 (V1.1+ tendrá `app.leave_place` con design
-- separado para que un miembro no-owner se salga por su cuenta).
--
-- ## Decisión V1: soft-remove (UPDATE left_at) no DELETE físico
--
-- A diferencia de `app.revoke_invitation` (migration 0019, S3) que DELETE
-- físico, acá hacemos UPDATE. Razones:
--
--   1. **Derecho al olvido estructurado** (ontologia §"Cuatro"): el
--      contenido del ex-miembro queda atribuido a su nombre histórico en
--      el place. Un DELETE físico de `membership` quebraría referencias
--      futuras (V1.1+ contenido FK-ea a membership_id; V1 no lo hace
--      todavía pero el invariante se reserva para no atarse las manos).
--   2. **Lifecycle column es schema canónico**: `membership.left_at`
--      existe en el schema (0001) específicamente para este propósito —
--      soft-delete vía nullable timestamp es el patrón ya elegido (vs.
--      tabla de auditoría aparte).
--   3. **UNIQUE (user_id, place_id) preservado**: el constraint sigue
--      activo post-remove. Re-join requiere V1.1+ `app.rejoin_place` (que
--      UPDATE-ee `left_at = NULL` + reset `joined_at = now()`) o
--      decisión explícita de modelo (¿re-usar la fila o crear nueva
--      preservando historia?). V1 deja el invariante "una membership por
--      (user, place) — soft-removed implica no re-join sin función
--      explícita".
--   4. **Auditoría futura**: V1.1+ con `membership_event_log` puede
--      lookup-ear `left_at` para correlate con eventos sin tener que
--      reconstruir historia desde otro log.
--
-- ## Pre-conditions in body (6)
--
-- Validadas en el cuerpo en orden tal que el primer fail relevante manda
-- (defense-in-depth + diagnóstico claro + anti-info-leak):
--
--   1. **caller autenticado**: `app.current_user_id() IS NOT NULL`. Falla
--      `28000 invalid_authorization_specification`. Misma superficie estándar
--      PG que el resto de las DEFINER del proyecto.
--   2. **app_user existe para el caller**: lookup `app_user WHERE
--      auth_user_id = caller_claim` → `v_caller`. Falla `P0002` (compat
--      con `app.create_place`/`app.elevate_to_owner`/`app.create_invitation`
--      — edge case claim válido sin app_user, no esperado runtime normal).
--      Necesitamos `v_caller` para self-check (pre-condition 4) — sin él
--      no podemos discriminar caller==target.
--   3. **caller is owner del place**: `app.current_user_owns_place(p_place_id)
--      = true`. Falla `P0001 caller is not an owner of this place`. Captura
--      uniformemente cross-place + place inexistente + member-no-owner con
--      MISMO message (anti-info-leak: no diferenciar entre "no soy owner de
--      NADA" vs "no soy owner de ESTE place" — preserva property que el
--      caller no puede inferir membership ajena).
--   4. **target NO es el caller (no self-remove V1)**: `p_target_user_id ≠
--      v_caller`. Falla `P0001 cannot self-remove; use leave_place (V1.1+)`.
--      Evaluado ANTES de target-is-owner (pre-condition 5) para que el caso
--      patológico caller=target=founder+owner (T6) caiga acá con mensaje
--      específico en lugar del genérico 'target is owner'. La diferencia
--      importa al UI consumer: V1.1+ podría agregar UI distinto para
--      "salirte del place" vs "removerte como owner". V1 bloquea explícito
--      ambos paths (gap consciente spec §"Gaps V1": leave_place V1.1+).
--   5. **target NO es owner del place** (separation of concerns con
--      `app.revoke_ownership`): `EXISTS (place_ownership WHERE place_id AND
--      user_id = target)`. Si target ES owner: `P0001 target is an owner;
--      revoke ownership first`. Cubre target founder naturalmente (founder
--      ES owner por construcción + `place.founder_user_id` apunta). El path
--      correcto para expulsar a un owner:
--        a. Si target es founder: transfer_founder_ownership PRIMERO →
--           revoke_ownership (sobre el nuevo founder de target) → remove_member.
--        b. Si target es co-owner: revoke_ownership PRIMERO → remove_member.
--      Esta separación garantiza que `place_ownership` no quede orfana de
--      su `membership` (invariante "owner ⊆ miembro activo" del schema).
--   6. **target es miembro activo** (membership existe AND left_at IS NULL):
--      `EXISTS (membership WHERE place_id AND user_id = target AND left_at
--      IS NULL)`. Si no: `P0001 target is not an active member`. Captura
--      uniformemente: target sin membership en place (T7) + target con
--      membership ya removida (T8) con MISMO message — evita info-leak
--      sobre historial de membership pasada (un caller owner no debería
--      poder distinguir "este user nunca fue miembro" vs "este user fue
--      removido el mes pasado" si el ex-miembro no está activo).
--
-- ## Por qué el orden importa
--
--   1-2 → estructura del schema (auth + app_user lookup).
--   3   → autorización del caller sobre el recurso.
--   4   → self-check ANTES de target-is-owner (T6 fija el mensaje
--         'cannot self-remove' en caso patológico self=owner).
--   5   → invariante separation-of-concerns con revoke_ownership.
--   6   → existencia y estado activo del target.
--
-- Reordenarlo cambia mensajes en casos patológicos → confunde al UI consumer
-- (V1 wrapper S8) y posiblemente filtra info por diferencia de mensajes.
-- T4/T5/T6 fijan el orden self→owner→active-member explícitamente con
-- `.toMatch` asserts sobre los messages específicos.
--
-- ## `archived_at` del place NO bloquea remove
--
-- Decisión operativa spec §"Decisión operativa": mantenimiento de places
-- archivados permitido (un owner puede querer limpiar miembros antes de
-- purga física). La función NO consulta `place.subscription_status` ni
-- `place.archived_at`. Idéntica decisión a `app.revoke_ownership` (S3 Feature
-- D) y `app.create_invitation` (S2 Feature E).
--
-- ## UPDATE WHERE explícito con left_at IS NULL
--
-- El body filtra `WHERE left_at IS NULL` en la cláusula del UPDATE incluso
-- después de que pre-condition 6 ya validó. Razón: defense-in-depth contra
-- race time-of-check-to-time-of-use (otra tx podría haber UPDATE-eado
-- left_at entre el SELECT EXISTS de pre-condition 6 y el UPDATE — el
-- UNIQUE(user_id, place_id) descarta la posibilidad de fila duplicada, pero
-- el WHERE explícito hace que el UPDATE sea idempotente bajo concurrent
-- removes). En la práctica con harness inRlsTx no hay race (ROLLBACK por
-- test), pero el patrón defensivo se preserva canónico.
--
-- ## Idempotencia bajo CREATE OR REPLACE
--
-- Drizzle re-aplica migrations en cada branch test fresh. CREATE OR REPLACE
-- preserva la signature; REVOKE/GRANT post-CREATE son idempotentes. Sin
-- DROP previo (ningún otro objeto depende de la signature `(text, text)`).
--
-- ## Reverse SQL (rollback puntual)
--
--   REVOKE EXECUTE ON FUNCTION app.remove_member(text, text) FROM "app_system";
--   DROP FUNCTION IF EXISTS app.remove_member(text, text);
--
-- Sin caveats: la función es self-contained. Post-rollback, cualquier
-- intento de invocarla falla con `42883 undefined_function` (estado
-- pre-migración). Las filas `membership` con `left_at` ya UPDATE-eado via
-- S4 quedan así (la operación es semánticamente reversible vía manual
-- UPDATE SET left_at = NULL, pero la función reverse no la incluye —
-- semánticamente "deshacer un remove" no es operación canónica V1).

CREATE OR REPLACE FUNCTION app.remove_member(p_target_user_id text, p_place_id text)
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

  -- Pre-condition 2: app_user existe para el caller. Necesario para
  -- self-check (Pre 4) — sin v_caller no podemos discriminar caller==target.
  SELECT id INTO v_caller FROM app_user WHERE auth_user_id = v_auth;
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'app_user inexistente para el caller' USING errcode = 'P0002';
  END IF;

  -- Pre-condition 3: caller is owner del place. Captura uniformemente
  -- cross-place + place inexistente + member-no-owner con MISMO message
  -- (anti-info-leak: no diferenciar entre "no soy owner de NADA" vs "no
  -- soy owner de ESTE place").
  IF NOT app.current_user_owns_place(p_place_id) THEN
    RAISE EXCEPTION 'caller is not an owner of this place' USING errcode = 'P0001';
  END IF;

  -- Pre-condition 4: target NO es el caller (no self-remove V1). Evaluado
  -- ANTES de target-is-owner (Pre 5) para que el caso patológico
  -- caller=target=founder+owner caiga acá con mensaje específico. V1.1+
  -- tendrá `app.leave_place` con design separado.
  IF p_target_user_id = v_caller THEN
    RAISE EXCEPTION 'cannot self-remove; use leave_place (V1.1+)' USING errcode = 'P0001';
  END IF;

  -- Pre-condition 5: target NO es owner del place (separation of concerns
  -- con `app.revoke_ownership` Feature D). Cubre target founder
  -- naturalmente (founder ES owner por construcción). Path correcto para
  -- expulsar owner: revoke_ownership PRIMERO + remove_member DESPUÉS
  -- (preserva invariante "owner ⊆ miembro activo").
  IF EXISTS (
    SELECT 1 FROM place_ownership
    WHERE place_id = p_place_id AND user_id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'target is an owner; revoke ownership first' USING errcode = 'P0001';
  END IF;

  -- Pre-condition 6: target es miembro activo (membership existe AND
  -- left_at IS NULL). Captura uniformemente target sin membership en place
  -- + target ya-removido con MISMO message (anti-info-leak: no diferenciar
  -- "nunca fue miembro" vs "fue removido en el pasado").
  IF NOT EXISTS (
    SELECT 1 FROM membership
    WHERE place_id = p_place_id AND user_id = p_target_user_id AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'target is not an active member' USING errcode = 'P0001';
  END IF;

  -- All pre-conditions satisfied: soft-remove via UPDATE left_at = now().
  -- WHERE explícito con `left_at IS NULL` es defense-in-depth contra race
  -- TOCTOU (otra tx podría haber UPDATE-eado entre Pre 6 y este UPDATE —
  -- el UNIQUE(user_id, place_id) descarta fila duplicada; el WHERE hace
  -- el UPDATE idempotente bajo concurrent removes). La fila NO se DELETE-ea
  -- — preserva FKs futuros de contenido del ex-miembro (ontologia §"Cuatro
  -- Derecho al olvido estructurado") + historial joined_at + invariante
  -- UNIQUE bloqueando re-join sin app.rejoin_place (V1.1+).
  UPDATE membership SET left_at = now()
  WHERE place_id = p_place_id AND user_id = p_target_user_id AND left_at IS NULL;
END;
$$;--> statement-breakpoint

-- ACL: EXECUTE sólo a `app_system` (rol runtime), denegado a PUBLIC.
-- Idempotente bajo CREATE OR REPLACE (grants preservados).
REVOKE EXECUTE ON FUNCTION app.remove_member(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.remove_member(text, text) TO "app_system";
