-- Feature E · S2 (ADR-0010 §2 + ADR-0037 §4, 2026-05-24) — primer mutador
-- DEFINER del flow invitations. Canaliza el INSERT en `invitation` con gate
-- V1 hardcoded owner-only. Complementa al `app.accept_invitation` (migration
-- 0003, S2 de invite flow histórica) que vive en el lado del invitado; este
-- vive en el lado del owner que crea la capability.
--
-- ## Decisión V1: gate hardcoded owner-only (ADR-0037 §4)
--
-- V1 sólo el owner del place invita. El check usa `app.current_user_owns_place
-- (p_place_id)` (helper SECURITY DEFINER STABLE de migration 0012) — mismo
-- helper que cubre la `po_sel` policy + el resto de las DEFINER del slice
-- ownership. V2+ abrirá el gate a member-with-quota-available leyendo
-- `place.member_invite_quota` (columna agregada en migration 0017, schema-
-- only V1) + counter `membership.invitations_used` (V2+).
--
-- ## Pre-conditions in body (4)
--
-- Validadas en el cuerpo en orden tal que el primer fail relevante manda
-- (defense-in-depth + diagnóstico claro + anti-info-leak):
--
--   1. **caller autenticado**: `app.current_user_id() IS NOT NULL`. Falla
--      `28000 invalid_authorization_specification`. Misma superficie estándar
--      PG que el resto de las DEFINER del proyecto.
--   2. **app_user existe para el caller**: lookup `app_user WHERE
--      auth_user_id = caller_claim` → `v_caller`. Falla `P0002` (compat con
--      `app.create_place`/`app.elevate_to_owner`/`app.update_my_headline` —
--      edge case claim válido sin app_user, no esperado runtime normal).
--      Necesitamos `v_caller` para escribir `invitation.invited_by`.
--   3. **caller is owner del place**: `app.current_user_owns_place(p_place_id)
--      = true`. Falla `P0001 caller is not an owner of this place`. Captura
--      uniformemente 3 paths con MISMO message (anti-info-leak: no diferenciar
--      place-not-found de cross-place de member-no-owner para no exponer
--      existencia de place_ids o memberships):
--        - place_id inexistente: helper retorna false (sin fila en
--          place_ownership con ese place_id).
--        - caller cross-place (owner de OTRO place): helper retorna false
--          para ESTE place_id.
--        - caller member-no-owner: el helper sólo lee place_ownership,
--          ignora membership → caller miembro pero no en place_ownership
--          → false.
--   4. **p_expires_at > now() strict**: rechaza fecha en pasado, fecha en
--      now() exact (boundary). Falla `P0001 expires_at must be in the
--      future`. La función NO delega a CHECK constraint sobre la columna
--      (no existe; el invariante semántico vive acá).
--
-- ## Body: generación del token (URL-safe, 256 bits entropy)
--
-- El token es `replace(gen_random_uuid()::text, '-', '') || replace(
-- gen_random_uuid()::text, '-', '')` → 64 chars hex, URL-safe by
-- construction (sólo [0-9a-f]). 2 UUIDs concatenados aportan 256 bits de
-- entropy (cada UUID tiene 122 bits efectivos + bits de versión/variant —
-- la concat usa 256 chars hex pero sólo ~244 bits de entropy real; está
-- por encima del threshold canónico de 128 bits para tokens de capability
-- short-lived). Spec §CU2 menciona "base64url 32 bytes" como guidance soft;
-- hex 64 chars cubre el invariante de URL-safety y entropy comparable.
--
-- Sin extensión pgcrypto requerida (consistente con el resto del schema —
-- todas las PKs usan `gen_random_uuid()` core de PG17 sin pgcrypto).
--
-- ## Email passthrough sin re-validación (defense-in-depth en zod app-side)
--
-- La función NO valida formato del email — trata el argumento como string
-- opaco e inserta tal cual. Razón: defense-in-depth se concentra en zod
-- app-side (Server Action `createInvitationAction` S7 validará con
-- `z.string().email()` antes de invocar la DEFINER); duplicar la
-- validación en SQL agregaría brittleness sin valor (regex de email en SQL
-- es notoriamente unreliable). El test T9 fija este contract explícito.
--
-- ## Token collision (23505 unique_violation)
--
-- `invitation.token UNIQUE` (schema 0001). En caso extremadamente
-- improbable (~ 1/2^244) de colisión de UUID concat, el INSERT falla
-- `23505 unique_violation`; el caller debería retry. La función NO maneja
-- internamente (sin retry loop — defense-in-depth contra runaway loop bajo
-- bug de entropy); el wrapper TS V1.1+ podría mapear `23505` a un retry
-- automático si emergiera necesidad real.
--
-- ## Idempotencia bajo CREATE OR REPLACE
--
-- Drizzle re-aplica migrations en cada branch test fresh. CREATE OR REPLACE
-- preserva la signature; REVOKE/GRANT post-CREATE son idempotentes. Sin
-- DROP previo (ningún otro objeto depende de la signature
-- `(text, text, timestamptz)`).
--
-- ## Reverse SQL (rollback puntual)
--
--   REVOKE EXECUTE ON FUNCTION app.create_invitation(text, text, timestamptz) FROM "app_system";
--   DROP FUNCTION IF EXISTS app.create_invitation(text, text, timestamptz);
--
-- Sin caveats: la función es self-contained. Post-rollback, cualquier
-- intento de invocarla falla con `42883 undefined_function` (estado
-- pre-migración). Las filas `invitation` ya creadas via S2 quedan intactas
-- (la función NO toca el schema, sólo INSERT-ea via API canónica).

CREATE OR REPLACE FUNCTION app.create_invitation(
  p_place_id   text,
  p_email      text,
  p_expires_at timestamptz
) RETURNS json
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth   text := app.current_user_id();
  v_caller text;
  v_id     text;
  v_token  text;
BEGIN
  -- Pre-condition 1: caller autenticado.
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'no autenticado' USING errcode = '28000';
  END IF;

  -- Pre-condition 2: app_user existe para el caller (necesario para
  -- `invitation.invited_by`).
  SELECT id INTO v_caller FROM app_user WHERE auth_user_id = v_auth;
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'app_user inexistente para el caller' USING errcode = 'P0002';
  END IF;

  -- Pre-condition 3: caller is owner del place (gate V1 hardcoded —
  -- ADR-0037 §4). Captura uniformemente place-not-found + cross-place +
  -- member-no-owner con mismo message (anti-info-leak).
  IF NOT app.current_user_owns_place(p_place_id) THEN
    RAISE EXCEPTION 'caller is not an owner of this place' USING errcode = 'P0001';
  END IF;

  -- Pre-condition 4: expires_at strictly in future (rechaza pasado + boundary
  -- now() exact). Sin CHECK constraint sobre la columna — el invariante
  -- semántico vive acá.
  IF p_expires_at <= now() THEN
    RAISE EXCEPTION 'expires_at must be in the future' USING errcode = 'P0001';
  END IF;

  -- Token: 2 UUIDs concatenated → 64 hex chars, URL-safe by construction.
  -- ~244 bits de entropy efectiva (por encima del threshold canónico 128 bits
  -- para capability tokens short-lived). Sin pgcrypto (consistente con resto
  -- del schema).
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  -- INSERT atómico. invited_by = caller (P0002 garantiza app_user existe).
  -- accepted_at toma su DEFAULT NULL (schema). id toma DEFAULT
  -- `(gen_random_uuid())::text` (schema 0001).
  INSERT INTO invitation (place_id, email, invited_by, expires_at, token)
  VALUES (p_place_id, p_email, v_caller, p_expires_at, v_token)
  RETURNING id INTO v_id;

  -- Return JSON con id + token para que el caller arme el link
  -- `https://<host>/invite/<token>` sin necesitar segunda query.
  RETURN json_build_object('invitation_id', v_id, 'token', v_token);
END;
$$;--> statement-breakpoint

-- ACL: EXECUTE sólo a `app_system` (rol runtime), denegado a PUBLIC.
-- Idempotente bajo CREATE OR REPLACE (grants preservados).
REVOKE EXECUTE ON FUNCTION app.create_invitation(text, text, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.create_invitation(text, text, timestamptz) TO "app_system";
