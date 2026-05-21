-- ADR-0022 + feature `settings` S2a.1 (2026-05-21): overload de 6 argumentos
-- de `app.create_place` que setea `default_locale` desde el caller. La
-- signature 5-arg de migration 0002 NO se toca — Postgres trata las dos
-- aridades como funciones distintas (overload por arity), así que la firma
-- vieja sigue intacta como compatibility surface y la nueva convive.
--
-- Backward-compat 100%: si emerge un caller viejo (cache de plan, código
-- legacy temporal, etc.) que invoque `app.create_place(text,text,text,jsonb,
-- jsonb)`, Postgres encuentra la signature de 0002 y la columna nueva
-- `place.default_locale` toma su DEFAULT 'es' (migration 0006). El código
-- nuevo (place-creation S2a.2) invoca SIEMPRE este overload de 6-arg con un
-- locale validado por zod.
--
-- Mismo patrón que 0002: SECURITY DEFINER + SET search_path fijo (anti-hijack
-- obligatorio en DEFINER), caller desde `app.current_user_id()` (NUNCA
-- parámetro — verificado 2026-05-17 que el GUC tx-local del caller no es
-- sombreado por el DEFINER), idempotente via CREATE OR REPLACE +
-- REVOKE/GRANT idempotentes en la signature exacta de 6-arg.
CREATE OR REPLACE FUNCTION app.create_place(
  p_slug text, p_name text, p_description text,
  p_theme_config jsonb, p_opening_hours jsonb,
  p_default_locale text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth text := app.current_user_id();
  v_uid  text;
  v_pid  text;
BEGIN
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'no autenticado' USING errcode = '28000';
  END IF;
  SELECT id INTO v_uid FROM app_user WHERE auth_user_id = v_auth;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'app_user inexistente para el caller' USING errcode = 'P0002';
  END IF;
  INSERT INTO place (slug, name, description, theme_config, opening_hours,
                     default_locale, billing_mode, subscription_status,
                     trial_ends_at, enabled_features)
  VALUES (p_slug, p_name, p_description, p_theme_config, p_opening_hours,
          p_default_locale, 'OWNER_PAYS', 'ACTIVE',
          now() + interval '30 days', '[]'::jsonb)
  RETURNING id INTO v_pid;
  INSERT INTO place_ownership (user_id, place_id) VALUES (v_uid, v_pid);
  INSERT INTO membership      (user_id, place_id) VALUES (v_uid, v_pid);
  RETURN v_pid;
END;
$$;--> statement-breakpoint
-- EXECUTE sólo `app_system` (no PUBLIC) — idéntico al patrón de la 5-arg.
-- Idempotente: REVOKE de PUBLIC no falla si nunca tuvo grant; GRANT a
-- app_system no falla si ya lo tenía.
REVOKE EXECUTE ON FUNCTION app.create_place(text,text,text,jsonb,jsonb,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.create_place(text,text,text,jsonb,jsonb,text) TO "app_system";
