-- Feature D · S1 (anticipado del scope original S5, 2026-05-24) — Refactor de
-- `app.create_place` para incluir `place.founder_user_id := caller.user_id` en
-- el INSERT. Single source of truth: ADR-0035 §Decisión 2 (CU1 refinado).
--
-- ## Por qué anticipado de S5
--
-- La migration 0012 cerró el invariante `place.founder_user_id NOT NULL`. Sin
-- este refactor en la misma sesión, la ÚNICA vía de creación de places (`app.
-- create_place`, ADR-0012 §3) ejecutaría `INSERT INTO place (...)` SIN la
-- columna `founder_user_id` → `null value violates not-null constraint` →
-- todo `app.create_place()` en runtime falla. Production-bug, no test-bug:
-- cualquier usuario que crea un place desde la UI explota.
--
-- El plan-sesiones.md S5 original ponía este refactor 4 sesiones más tarde,
-- pero el SET NOT NULL en S1 obliga a refactorar `create_place` en la misma
-- sesión. Pattern industry-standard: nunca aplicar un constraint hasta que la
-- única vía de creación oficial lo respete (expand-contract). Documentado en
-- write-back de plan-sesiones.md S1 + addendum S5 (S5 mantiene los regression
-- tests + data-model.md write-back, sin migration nueva).
--
-- ## Ambos overloads refactorizados (5-arg + 6-arg)
--
-- Postgres trata distintas aridades como funciones distintas (overload por
-- arity). La 5-arg (migration 0002) queda como compat surface para callers
-- viejos; la 6-arg (migration 0007) es el caller actual del wizard. Ambas
-- deben incluir `founder_user_id` — un caller viejo que use 5-arg también
-- crearía place huérfano sin este refactor.
--
-- ## Cambios quirúrgicos vs migrations originales
--
-- Sólo dos cosas cambian en cada cuerpo:
--   (a) Agregar `founder_user_id` al final de la lista de columnas del INSERT.
--   (b) Agregar `v_uid` al final del VALUES (el caller es el founder).
--
-- `v_uid` ya existe en ambos cuerpos (lo calcula el lookup de `app_user`).
-- El resto del cuerpo (autenticación, lookup, ownership/membership INSERT,
-- RETURNING) queda intacto. Backward-compat 100%.
--
-- ## Reverse SQL (rollback puntual)
--
-- Re-aplicar el cuerpo de migrations 0002 y 0007 (CREATE OR REPLACE
-- idempotente). Manual:
--
--   CREATE OR REPLACE FUNCTION app.create_place(...) <cuerpo migration 0002>;
--   CREATE OR REPLACE FUNCTION app.create_place(...) <cuerpo migration 0007>;
--
-- Tras rollback, también rollback de 0012 (DROP NOT NULL en founder_user_id).

-- Refactor 6-arg (la usada actualmente por place-creation, ADR-0022).
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
                     trial_ends_at, enabled_features, founder_user_id)
  VALUES (p_slug, p_name, p_description, p_theme_config, p_opening_hours,
          p_default_locale, 'OWNER_PAYS', 'ACTIVE',
          now() + interval '30 days', '[]'::jsonb, v_uid)
  RETURNING id INTO v_pid;
  INSERT INTO place_ownership (user_id, place_id) VALUES (v_uid, v_pid);
  INSERT INTO membership      (user_id, place_id) VALUES (v_uid, v_pid);
  RETURN v_pid;
END;
$$;--> statement-breakpoint

-- Refactor 5-arg (compat surface para callers legacy — sin default_locale,
-- la columna toma su DEFAULT 'es' de migration 0006).
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
                     billing_mode, subscription_status, trial_ends_at,
                     enabled_features, founder_user_id)
  VALUES (p_slug, p_name, p_description, p_theme_config, p_opening_hours,
          'OWNER_PAYS', 'ACTIVE', now() + interval '30 days', '[]'::jsonb, v_uid)
  RETURNING id INTO v_pid;
  INSERT INTO place_ownership (user_id, place_id) VALUES (v_uid, v_pid);
  INSERT INTO membership      (user_id, place_id) VALUES (v_uid, v_pid);
  RETURN v_pid;
END;
$$;--> statement-breakpoint

-- Idempotente: REVOKE/GRANT sobre signatures existentes no falla; los grants
-- previos de 0002/0007 se preservan bajo CREATE OR REPLACE.
REVOKE EXECUTE ON FUNCTION app.create_place(text,text,text,jsonb,jsonb,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.create_place(text,text,text,jsonb,jsonb,text) TO "app_system";--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.create_place(text,text,text,jsonb,jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.create_place(text,text,text,jsonb,jsonb) TO "app_system";
