-- Feature E · S3 (ADR-0010 §2 + spec §CU3, 2026-05-24) — 2do mutador
-- DEFINER del flow invitations. Cancela una invitation pending: DELETE
-- físico (la capability deja de existir; el token queda inválido
-- inmediatamente). Complementa al `app.create_invitation` (migration 0018,
-- S2). NO es contraparte de `app.accept_invitation` (migration 0003) — esa
-- vive en el lado del invitado y consume el token; ésta vive en el lado del
-- owner que cancela una capability aún no consumida.
--
-- ## Decisión V1: DELETE físico (no soft-delete `revoked_at`)
--
-- El contract es "esta capability no existe más". Sin columna `revoked_at` en
-- schema, sin estado intermedio "revoked vs accepted vs pending"; revocar =
-- borrar. Razones:
--
--   1. Token UNIQUE constraint: si dejáramos la fila con un flag soft, el
--      mismo email podría re-invitarse pero la fila vieja seguiría reservando
--      el token UNIQUE. Un DELETE libera el slot trivialmente.
--   2. Capability semantics: el invitee que entra al link `/invite/<token>`
--      debería ver "este link ya no existe" (404) — comportamiento idéntico
--      a "este link nunca existió". Una fila soft-deleted forzaría a
--      `app.accept_invitation` (migration 0003) a chequear un flag adicional
--      y distinguir "expired" vs "revoked" en la UI sin valor real.
--   3. Auditoría no es V1: si en V2+ aparece "audit log de invitations
--      revocadas", se agrega tabla aparte `invitation_revoked_audit` con
--      INSERT trigger; no impacta el contract V1.
--
-- ## Pre-conditions in body (4)
--
-- Validadas en el cuerpo en orden tal que el primer fail relevante manda
-- (defense-in-depth + diagnóstico claro + anti-info-leak donde aplica):
--
--   1. **caller autenticado**: `app.current_user_id() IS NOT NULL`. Falla
--      `28000 invalid_authorization_specification`. Misma superficie estándar
--      PG que el resto de las DEFINER del proyecto.
--   2. **invitation existe**: lookup `(place_id, accepted_at)` por id. Si
--      la fila no existe: `P0001 invitation not found`. NO es anti-info-leak
--      (invitation IDs son UUIDs con 2^122 posibilidades — enumeración
--      infeasible); un error claro acá ayuda al wrapper TS S7 a discriminar
--      UI casos (e.g., user click revoke en stale UI tras GC eventual).
--      Necesitamos `v_place_id` para el owner check siguiente y
--      `v_accepted_at` para el check de Pre 4.
--   3. **caller is owner del place de la invitation**:
--      `app.current_user_owns_place(v_place_id) = true`. Falla `P0001
--      caller is not an owner of this place`. Captura uniformemente
--      cross-place + member-no-owner con MISMO message (anti-info-leak:
--      no diferenciar "no soy owner de NADA" vs "no soy owner de ESTE
--      place" — el caller no debe poder inferir membership ajena).
--   4. **invitation NO ya aceptada**: `v_accepted_at IS NULL`. Si NOT NULL:
--      `P0001 cannot revoke already-accepted invitation`. Una invitation
--      aceptada ya consumió su capability (creó membership vía
--      `app.accept_invitation` migration 0003); revocarla acá dejaría
--      `membership` huérfana sin path de remediación obvio. El path correcto
--      post-aceptación es `app.remove_member` (S4, próxima migration).
--      Evaluado DESPUÉS del owner check para no leak-ear el `accepted_at`
--      status a no-owners (la fila no se debería ver por no-owner; el orden
--      preserva esa propiedad).
--
-- ## Por qué NO P0002 lookup de app_user
--
-- A diferencia de `app.create_invitation` (S2, escribe `invited_by`) y
-- `app.update_my_headline` (S1, escribe `WHERE user_id = caller`), esta
-- función NO necesita `v_caller` — el body es un DELETE acotado por id de
-- invitation. El gate de ownership ya valida la sesión vía
-- `current_user_owns_place(text)` que internamente lee el claim
-- `app.current_user_id()` (SECURITY DEFINER STABLE, migration 0012). Skip-ear
-- el lookup app_user evita una query redundante; el edge case "claim válido
-- sin app_user" se vuelve a 28000 desde la pre-condition 1 antes de llegar
-- al owner check (current_user_owns_place internamente retorna false si
-- el claim no resuelve a un app_user — el caller ve P0001 'not an owner',
-- anti-info-leak preserved).
--
-- ## Expired pending revoke OK
--
-- Si `expires_at < now()` AND `accepted_at IS NULL`, la invitation está
-- "consumida por timeout" (un intento de accept fallaría con expired error
-- desde `app.accept_invitation`) pero sigue siendo cancellable acá: el owner
-- puede limpiar UI sin esperar GC eventual. El contract NO discrimina entre
-- pending fresh y pending expired — ambos son revocables. Sólo
-- `accepted_at IS NOT NULL` bloquea revoke (Pre 4). Test T8 fija este
-- contract.
--
-- ## Token re-usabilidad post-DELETE
--
-- El DELETE libera el slot del UNIQUE constraint sobre `invitation.token`. Si
-- el owner inmediatamente re-invita al mismo email, el nuevo token será
-- distinto (gen_random_uuid concat, ~244 bits entropy — colisión imposible
-- en práctica) pero el token revocado podría reusarse técnicamente. Esto NO
-- es un riesgo de seguridad: una vez DELETE-eado, el token no existe en
-- ninguna fila, y `app.accept_invitation` (que lookea por token) retornará
-- "not found". Si el token revocado se re-genera por casualidad cósmica
-- (probabilidad infinitesimal), la nueva invitation es válida — pero el
-- token físico es distinto (UUID concat fresco) por construcción.
--
-- ## Idempotencia bajo CREATE OR REPLACE
--
-- Drizzle re-aplica migrations en cada branch test fresh. CREATE OR REPLACE
-- preserva la signature; REVOKE/GRANT post-CREATE son idempotentes. Sin
-- DROP previo (ningún otro objeto depende de la signature `(text)`).
--
-- ## Reverse SQL (rollback puntual)
--
--   REVOKE EXECUTE ON FUNCTION app.revoke_invitation(text) FROM "app_system";
--   DROP FUNCTION IF EXISTS app.revoke_invitation(text);
--
-- Sin caveats: la función es self-contained. Post-rollback, cualquier
-- intento de invocarla falla con `42883 undefined_function` (estado
-- pre-migración). Las filas `invitation` ya DELETE-eadas via S3 quedan
-- borradas irrecuperablemente (la operación es destructiva por diseño).

CREATE OR REPLACE FUNCTION app.revoke_invitation(p_invitation_id text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth        text := app.current_user_id();
  v_place_id    text;
  v_accepted_at timestamptz;
BEGIN
  -- Pre-condition 1: caller autenticado.
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'no autenticado' USING errcode = '28000';
  END IF;

  -- Pre-condition 2: invitation existe. Lookup `(place_id, accepted_at)` —
  -- ambos necesarios para Pre 3 y Pre 4. Si no existe, P0001 'invitation
  -- not found' (no es info-leak — invitation IDs son UUIDs 2^122,
  -- enumeración infeasible; error claro ayuda al wrapper TS a discriminar).
  SELECT place_id, accepted_at INTO v_place_id, v_accepted_at
  FROM invitation WHERE id = p_invitation_id;
  IF v_place_id IS NULL THEN
    RAISE EXCEPTION 'invitation not found' USING errcode = 'P0001';
  END IF;

  -- Pre-condition 3: caller is owner del place de la invitation. Captura
  -- uniformemente cross-place + member-no-owner + claim-sin-app_user con
  -- MISMO message (anti-info-leak: no diferenciar entre "no soy owner de
  -- nada" vs "no soy owner de ESTE place" para no exponer membership
  -- ajena).
  IF NOT app.current_user_owns_place(v_place_id) THEN
    RAISE EXCEPTION 'caller is not an owner of this place' USING errcode = 'P0001';
  END IF;

  -- Pre-condition 4: invitation NO ya aceptada. Evaluado DESPUÉS del owner
  -- check para no leak-ear `accepted_at` status a no-owners. Si aceptada,
  -- path correcto es `app.remove_member` (S4) — revoke acá dejaría
  -- membership huérfana sin remediación obvia.
  IF v_accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot revoke already-accepted invitation' USING errcode = 'P0001';
  END IF;

  -- Body: DELETE físico (capability ceases to exist; token immediately
  -- invalid via cascade en `app.accept_invitation` lookup). Sin soft-delete
  -- (no hay columna `revoked_at`; el contract es "esta capability no existe
  -- más"). El UNIQUE constraint sobre token se libera trivialmente.
  DELETE FROM invitation WHERE id = p_invitation_id;
END;
$$;--> statement-breakpoint

-- ACL: EXECUTE sólo a `app_system` (rol runtime), denegado a PUBLIC.
-- Idempotente bajo CREATE OR REPLACE (grants preservados).
REVOKE EXECUTE ON FUNCTION app.revoke_invitation(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.revoke_invitation(text) TO "app_system";
