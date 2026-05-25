-- Feature E · S1 (ADR-0036 §1 + ADR-0037 §1, 2026-05-24) — primera
-- migration del slice members V1. Agrega 2 columnas nuevas a 2 tablas + la
-- 4ta función DEFINER del slice (`app.update_my_headline`, self-edit del
-- headline del miembro acotado al caller).
--
-- ## Decisiones canónicas refinadas
--
--   1. **`membership.headline` opcional per place** (ADR-0036 §1). Bio
--      contextual ≤ 280 chars por (user, place). NULL por default — todas
--      las memberships existentes pre-migración quedan sin headline.
--      Decisión clave (ADR-0036 §3): edición SELF-ONLY (sólo el dueño de
--      la membership edita su propio headline; el owner del place NO edita
--      headlines ajenos). Refina ontologia/miembros.md §"Identidad
--      contextual (capa 2)".
--   2. **`place.member_invite_quota` int NOT NULL DEFAULT 0** (ADR-0037 §1).
--      Schema-only V1. Sin UI editor todavía (V2+); sin counter
--      `membership.invitations_used` todavía (V2+); sin gate runtime (V1
--      mantiene hardcoded owner-only en `app.create_invitation` S2). El
--      DEFAULT 0 preserva el comportamiento histórico pre-ADR-0037 (gate
--      hardcoded). CHECK >= 0 = invariante estructural (no soporta valores
--      negativos por diseño).
--   3. **`app.update_my_headline` SECURITY DEFINER** (spec.md §"Decisión
--      operativa" — Path B sobre Path A column-level policy). Aísla la
--      column exposure del UPDATE acotado al caller — la RLS owner-only de
--      `membership` BLOQUEA al miembro no-owner que intenta UPDATE directo
--      sobre su propia fila; el DEFINER bypassa la RLS pero acota
--      duramente WHERE user_id = caller (impossible editar headlines
--      ajenos desde el path).
--
-- ## Pre-conditions in body de `app.update_my_headline` (3)
--
--   1. **caller autenticado**: `app.current_user_id() IS NOT NULL`. Falla
--      `28000 invalid_authorization_specification`. Misma superficie que el
--      resto de las DEFINER del proyecto (independiente del MESSAGE; el
--      wrapper TS V1.1 discrimina por code).
--   2. **app_user existe para el caller**: lookup `app_user WHERE
--      auth_user_id = caller_claim`. Falla `P0002` (compat con
--      `app.create_place`/`app.elevate_to_owner` — edge case claim válido
--      pero sin app_user; no esperado runtime normal).
--   3. **caller is active member del place**: `EXISTS (membership WHERE
--      place_id = p_place_id AND user_id = caller AND left_at IS NULL)`.
--      Falla `P0001 caller is not an active member of this place`. Cubre 2
--      paths con misma condition: caller sin fila (nunca fue miembro) y
--      caller con fila left_at NOT NULL (ex-miembro). Owner-as-member es
--      path normal — owner ES también miembro activo por construcción.
--
-- ## Por qué NO `p_target_user_id`
--
-- La función intencionalmente NO acepta target — siempre escribe sobre el
-- caller. Eso fija el contract canónico: NO hay path desde la DEFINER para
-- que owner edite headline de otro (ADR-0036 §3). Tests T7 verifica
-- explícitamente que caller=alice (owner) UPDATE-ea SU PROPIA fila, no la
-- de bob (acotado al caller). Defensa contra una API futura que agregue
-- target por accidente.
--
-- ## Por qué NO re-validar length en el cuerpo
--
-- El CHECK constraint `membership_headline_length_chk` cubre el invariante
-- DB-side. zod app-side rechaza antes en runtime. Re-validar length en la
-- DEFINER sería redundante (defense-in-depth ya doble: zod + CHECK). Si
-- alguien skip-ea zod (testing, bug app-side), el CHECK preserva el
-- invariante — la DEFINER simplemente propaga el `23514`.
--
-- ## Idempotencia
--
-- Migration usa `IF NOT EXISTS` para columnas + `ALTER TABLE ... ADD
-- CONSTRAINT IF NOT EXISTS` no existe en PG — usamos un `DO $$ BEGIN ...
-- EXCEPTION WHEN duplicate_object THEN NULL; END $$` para los constraints.
-- `CREATE OR REPLACE FUNCTION` es naturalmente idempotente; REVOKE/GRANT
-- post-CREATE también.
--
-- ## Reverse SQL (rollback puntual)
--
-- Idempotente; aplicable si la migration corrió en una branch test y se
-- requiere volver al estado pre-S1. No automatizable por drizzle-kit (no
-- soporta `down`). Manual:
--
--   REVOKE EXECUTE ON FUNCTION app.update_my_headline(text, text) FROM "app_system";
--   DROP FUNCTION IF EXISTS app.update_my_headline(text, text);
--   ALTER TABLE place DROP CONSTRAINT IF EXISTS place_member_invite_quota_nonneg_chk;
--   ALTER TABLE place DROP COLUMN IF EXISTS member_invite_quota;
--   ALTER TABLE membership DROP CONSTRAINT IF EXISTS membership_headline_length_chk;
--   ALTER TABLE membership DROP COLUMN IF EXISTS headline;
--
-- Caveat: si alguna fila ya tiene `headline NOT NULL` post-edit, el DROP
-- COLUMN destruye esos valores irrecuperablemente. Idem `member_invite_quota`
-- si fue editado vía UI futura (V2+) a no-cero. Pre-condición de rollback en
-- production: confirmar que ninguna fila depende del dato.

ALTER TABLE membership
  ADD COLUMN IF NOT EXISTS headline text NULL;--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE membership
    ADD CONSTRAINT membership_headline_length_chk
    CHECK (headline IS NULL OR length(headline) <= 280);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;--> statement-breakpoint

ALTER TABLE place
  ADD COLUMN IF NOT EXISTS member_invite_quota integer NOT NULL DEFAULT 0;--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE place
    ADD CONSTRAINT place_member_invite_quota_nonneg_chk
    CHECK (member_invite_quota >= 0);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.update_my_headline(p_place_id text, p_new_headline text)
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
  -- signup; el guard P0002 mantiene la simetría con `app.create_place`
  -- y `app.elevate_to_owner`.
  SELECT id INTO v_caller FROM app_user WHERE auth_user_id = v_auth;
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'app_user inexistente para el caller' USING errcode = 'P0002';
  END IF;

  -- Pre-condition 3: caller is active member del place (cubre 2 paths:
  -- sin membership y membership left_at NOT NULL). Owner-as-member es path
  -- normal — owner ES también miembro activo por construcción.
  IF NOT EXISTS (
    SELECT 1 FROM membership
    WHERE place_id = p_place_id
      AND user_id = v_caller
      AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'caller is not an active member of this place' USING errcode = 'P0001';
  END IF;

  -- Body: UPDATE acotado al caller. NO `p_target_user_id` — el contract
  -- canónico fija que sólo el dueño edita su propio headline (ADR-0036 §3).
  -- Sin re-validación de length — delega al CHECK constraint
  -- `membership_headline_length_chk` (defense-in-depth: zod app-side +
  -- CHECK DB-side). El CHECK lanza `23514` si > 280; la DEFINER lo propaga.
  UPDATE membership
    SET headline = p_new_headline
    WHERE place_id = p_place_id
      AND user_id = v_caller;
END;
$$;--> statement-breakpoint

-- ACL: EXECUTE sólo a `app_system` (rol runtime), denegado a PUBLIC.
-- Idempotente bajo CREATE OR REPLACE (grants preservados).
REVOKE EXECUTE ON FUNCTION app.update_my_headline(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.update_my_headline(text, text) TO "app_system";
