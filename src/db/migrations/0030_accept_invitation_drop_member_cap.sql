-- Sin cap de miembros (ADR-0053 §6, follow-up post-pivot junto a ADR-0054) —
-- "no hay más límites de tamaño": el invariante "máx 150 miembros" murió como
-- dominio el 2026-06-11 y su ÚNICO enforcement en código vivía acá, en
-- `app.accept_invitation` (migration 0003, líneas 92-96: `SELECT count(*) …
-- IF v_count >= 150 THEN RAISE … errcode = 'P0009'`). Esta migration re-emite
-- la función SIN ese bloque (y sin la variable `v_count`, que sólo existía
-- para el check). El SQLSTATE P0009 queda inalcanzable: el app-side ya no lo
-- mapea (cae al genérico `unknown`, anti-info-leak como cualquier drift).
--
-- ## Qué conserva de la versión vigente (cero drift fuera del cap)
--
--   · Cuerpo canónico de 0003: autenticación (28000), lookup app_user (P0002),
--     lookup invitación (P0005), ya usada (P0007), vencida (P0006), email-match
--     estricto lower(btrim()) (P0008), test-and-set atómico de `accepted_at`
--     (gate de unicidad), INSERT membership, RETURN slug.
--   · `SECURITY DEFINER` + `SET search_path = public, pg_temp` (anti-hijack,
--     igual que 0003).
--   · `VOLATILE` ahora EXPLÍCITO en el CREATE: migration 0027 §3 lo había
--     fijado vía ALTER (CREATE OR REPLACE sin la keyword lo re-dejaría en el
--     default implícito de plpgsql — runtime idéntico, pero el canon
--     data-model.md §"Catálogo DEFINER" exige volatility explícita).
--   · ACL: CREATE OR REPLACE preserva los grants previos de 0003; el
--     REVOKE/GRANT idempotente al final re-afirma el canon (EXECUTE sólo
--     app_system), mismo patrón que 0013.
--
-- Sin `SET lock_timeout`: CREATE OR REPLACE de función sin DDL de tabla toma
-- lock trivial (canon data-model.md, mismo criterio que las migrations
-- DEFINER-only). Idempotente: re-run no rompe.
--
-- ## Reverse SQL (rollback puntual; drizzle-kit no soporta `down`)
--
--   Re-aplicar el cuerpo de migration 0003 (CREATE OR REPLACE FUNCTION
--   app.accept_invitation con el bloque del cap, líneas 57-111 de
--   src/db/migrations/0003_accept_invitation_fn.sql) + re-aplicar
--   `ALTER FUNCTION app.accept_invitation(text) VOLATILE;` (0027 §3).
--
-- Caveat del rollback: revertirla NO revive la decisión de producto — el cap
-- murió por ADR-0053 §6; resucitarlo requiere ADR nueva.

CREATE OR REPLACE FUNCTION app.accept_invitation(p_token text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth text := app.current_user_id();
  v_uid  text; v_email text;
  v_pid  text; v_inv_email text; v_exp timestamptz; v_acc timestamptz;
  v_set int;
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

-- Idempotente: los grants previos de 0003 se preservan bajo CREATE OR
-- REPLACE; el REVOKE/GRANT re-afirma el canon ACL (precedente: 0013).
REVOKE EXECUTE ON FUNCTION app.accept_invitation(text) FROM PUBLIC;--> statement-breakpoint
GRANT  EXECUTE ON FUNCTION app.accept_invitation(text) TO "app_system";
