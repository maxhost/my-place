-- ADR-0012 §3: la ÚNICA vía de creación de place. Función PROPIA escrita a
-- mano (Drizzle no modela SECURITY DEFINER; precedente: app.current_user_id()
-- en 0000). Migración sin diff de schema → no la genera drizzle-kit; se
-- versiona a mano y se registra en meta/_journal.json. Idempotente:
-- CREATE OR REPLACE + REVOKE/GRANT idempotentes.
--
-- Dueño = neondb_owner (rol de migraciones, BYPASSRLS → hace los 3 INSERT pese
-- a que app_system no tiene policy de INSERT, ADR-0012 §1). SET search_path
-- fijo (anti-hijack, obligatorio en DEFINER). Caller desde app.current_user_id()
-- (GUC tx-local del caller; verificado empíricamente 2026-05-17 que el DEFINER
-- NO lo sombrea), nunca parámetro. place_id lo GENERA la DB (no se acepta de
-- afuera) → B no puede apuntar ownership a un place ajeno. Billing/trial
-- deterministas (ADR-0005 §3). Atómica en la tx del caller.
CREATE OR REPLACE FUNCTION app.create_place(
  p_slug text, p_name text, p_description text,
  p_theme_config jsonb, p_opening_hours jsonb
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
                     billing_mode, subscription_status, trial_ends_at, enabled_features)
  VALUES (p_slug, p_name, p_description, p_theme_config, p_opening_hours,
          'OWNER_PAYS', 'ACTIVE', now() + interval '30 days', '[]'::jsonb)
  RETURNING id INTO v_pid;
  INSERT INTO place_ownership (user_id, place_id) VALUES (v_uid, v_pid);
  INSERT INTO membership      (user_id, place_id) VALUES (v_uid, v_pid);
  RETURN v_pid;
END;
$$;--> statement-breakpoint
-- EXECUTE solo app_system (no PUBLIC): la creación nunca es invocable por un
-- rol no previsto. Idempotente.
REVOKE EXECUTE ON FUNCTION app.create_place(text,text,text,jsonb,jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.create_place(text,text,text,jsonb,jsonb) TO "app_system";
