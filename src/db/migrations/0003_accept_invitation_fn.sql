-- ADR-0010 §2: invitación SOLO por token-link. Dos funciones PROPIAS escritas
-- a mano (Drizzle no modela SECURITY DEFINER; precedente: app.create_place en
-- 0002). Migración sin diff de schema → no la genera drizzle-kit; se versiona
-- a mano y se registra en meta/_journal.json. Idempotente: CREATE OR REPLACE
-- + REVOKE/GRANT idempotentes.
--
-- Mismo hardening que S3: dueño = neondb_owner (BYPASSRLS → lee `invitation`
-- owner-only e inserta en `membership`, ambos denegados a app_system por RLS,
-- ADR-0012 §1), SET search_path fijo (anti-hijack, obligatorio en DEFINER),
-- EXECUTE solo app_system (REVOKE … PUBLIC), sin SQL dinámico. La fila
-- `invitation` es del owner → un secreto (el token) no se expresa como regla
-- RLS de identidad: la valida/consume una función de confianza server-side.
--
-- SQLSTATE: 28000 no-autenticado · P0002 app_user inexistente (= create_place)
-- · P0005 invitación inexistente · P0006 vencida · P0007 ya usada · P0008
-- email mismatch · P0009 place lleno. P0001/2/3/4 son predefinidos de plpgsql;
-- P0005+ son libres. El app mapea cualquier excepción → error amable.

-- 2.1 Display solo-lectura. NO requiere claim: el token ES la capability
-- (ADR-0010) y el invitado aún puede no tener cuenta. Valida existe / no
-- vencido / no usado. Inválido → excepción (nada en la DB). Devuelve a qué
-- place lo invitan + el email (su propio inbox, no es fuga) para prefijar el
-- form de aceptación.
CREATE OR REPLACE FUNCTION app.invitation_preview(p_token text)
RETURNS TABLE (place_slug text, place_name text, invitee_email text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pid text; v_email text; v_exp timestamptz; v_acc timestamptz;
BEGIN
  SELECT place_id, email, expires_at, accepted_at
    INTO v_pid, v_email, v_exp, v_acc
    FROM invitation WHERE token = p_token;
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'invitación inexistente' USING errcode = 'P0005';
  END IF;
  IF v_acc IS NOT NULL THEN
    RAISE EXCEPTION 'invitación ya utilizada' USING errcode = 'P0007';
  END IF;
  IF v_exp <= now() THEN
    RAISE EXCEPTION 'invitación vencida' USING errcode = 'P0006';
  END IF;
  RETURN QUERY SELECT p.slug, p.name, v_email FROM place p WHERE p.id = v_pid;
END;
$$;--> statement-breakpoint

-- 2.2 Aceptación atómica (en la tx del caller). Requiere caller real:
-- `ensureAppUser` corrió app-side ANTES (como en S5b) → el app_user del caller
-- debe existir (P0002). Email-match ESTRICTO (ADR-0008): normalizado
-- lower(btrim()) — rechaza otra dirección, tolera capitalización/espacios. El
-- single-use / dos-aceptaciones-simultáneas lo resuelve el TEST-AND-SET
-- atómico `UPDATE … WHERE accepted_at IS NULL` (el perdedor afecta 0 filas →
-- aborta); `UNIQUE(user_id,place_id)` respalda contra doble membership. Crea
-- `membership` SIN crear place (alta desde invitación, ADR-0010 §2). Cualquier
-- RAISE/fallo revierte TODA la tx (accepted_at incluido) → nada huérfano.
CREATE OR REPLACE FUNCTION app.accept_invitation(p_token text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth text := app.current_user_id();
  v_uid  text; v_email text;
  v_pid  text; v_inv_email text; v_exp timestamptz; v_acc timestamptz;
  v_count int; v_set int;
BEGIN
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'no autenticado' USING errcode = '28000';
  END IF;
  SELECT id, email INTO v_uid, v_email FROM app_user WHERE auth_user_id = v_auth;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'app_user inexistente para el caller' USING errcode = 'P0002';
  END IF;

  SELECT place_id, email, expires_at, accepted_at
    INTO v_pid, v_inv_email, v_exp, v_acc
    FROM invitation WHERE token = p_token;
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'invitación inexistente' USING errcode = 'P0005';
  END IF;
  IF v_acc IS NOT NULL THEN
    RAISE EXCEPTION 'invitación ya utilizada' USING errcode = 'P0007';
  END IF;
  IF v_exp <= now() THEN
    RAISE EXCEPTION 'invitación vencida' USING errcode = 'P0006';
  END IF;
  IF lower(btrim(v_email)) <> lower(btrim(v_inv_email)) THEN
    RAISE EXCEPTION 'el email no coincide con la invitación' USING errcode = 'P0008';
  END IF;

  SELECT count(*) INTO v_count
    FROM membership WHERE place_id = v_pid AND left_at IS NULL;
  IF v_count >= 150 THEN
    RAISE EXCEPTION 'place lleno (máx 150 miembros)' USING errcode = 'P0009';
  END IF;

  -- Test-and-set atómico: el primero en llegar lo consume; un segundo
  -- (simultáneo o posterior) re-evalúa `accepted_at IS NULL` tras el commit
  -- del ganador → 0 filas → aborta. ESTE es el gate de unicidad.
  UPDATE invitation SET accepted_at = now()
   WHERE token = p_token AND accepted_at IS NULL;
  GET DIAGNOSTICS v_set = ROW_COUNT;
  IF v_set = 0 THEN
    RAISE EXCEPTION 'invitación ya utilizada' USING errcode = 'P0007';
  END IF;

  INSERT INTO membership (user_id, place_id) VALUES (v_uid, v_pid);
  RETURN (SELECT slug FROM place WHERE id = v_pid);
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app.invitation_preview(text) FROM PUBLIC;--> statement-breakpoint
GRANT  EXECUTE ON FUNCTION app.invitation_preview(text) TO "app_system";--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.accept_invitation(text) FROM PUBLIC;--> statement-breakpoint
GRANT  EXECUTE ON FUNCTION app.accept_invitation(text) TO "app_system";
