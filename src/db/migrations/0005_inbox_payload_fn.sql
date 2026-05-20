-- Hub V1 (docs/features/inbox/, sesión 2): `app.get_inbox_payload()` — payload
-- completo del hub en UNA sola call (perfil + places). Función PROPIA escrita
-- a mano (Drizzle no modela funciones; precedente: app.create_place en 0002,
-- app.accept_invitation en 0003). Migración sin diff de schema → no la genera
-- drizzle-kit; se versiona a mano y se registra en meta/_journal.json.
-- Idempotente: CREATE OR REPLACE + REVOKE/GRANT idempotentes.
--
-- SECURITY INVOKER (NO DEFINER): respeta la RLS extendida por ADR-0021
-- (place_sel + membership_sel ven owner OR miembro activo, ver migration
-- 0004). El user sólo ve sus propias filas; cero bypass. Testeable bajo el
-- patrón actual de `inRlsTx`. SET search_path fijo igualmente (anti-hijack
-- de funciones del propio search_path resoluble por el caller).
--
-- Shape JSON: snake_case (theme_accent, is_owner, joined_at) — el wrapper
-- TypeScript del slice `inbox` mapea a camelCase + tipos (Date, status union).
-- Las claves se construyen explícitas con jsonb_build_object (no
-- row_to_jsonb sobre subquery): más predecible, sin leaks futuros de columnas
-- agregadas a la subquery, y evita el edge case "row_to_jsonb(record) does not
-- exist" que ocurre cuando Postgres no infiere el composite type del alias.
-- theme_config tiene shape canónico `{colors: {accent, bg, ink}}` (data-model
-- §"Shapes JSON canónicos" + src/db/schema/json-shapes.ts).
--
-- SQLSTATE: 28000 no-autenticado (sin claim válido). Otros estados (app_user
-- inexistente para el caller) NO son excepción — retornan displayName=NULL,
-- places=[] (defensivo contra el caso "sesión Neon Auth válida sin app_user
-- aún provisionado", que no debería pasar tras ADR-0018 pero igual no rompe
-- el hub).

CREATE OR REPLACE FUNCTION app.get_inbox_payload()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth text := app.current_user_id();
  v_user_id text;
  v_display_name text;
  v_places jsonb;
BEGIN
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'no autenticado' USING errcode = '28000';
  END IF;

  -- Perfil del caller (RLS-safe: app_user_sel ya filtra a self).
  SELECT id, display_name INTO v_user_id, v_display_name
  FROM app_user WHERE auth_user_id = v_auth;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('displayName', NULL, 'places', '[]'::jsonb);
  END IF;

  -- Places del user (owner OR miembro activo). Visible bajo RLS extendida por
  -- ADR-0021 (membership_sel = owner|self; place_sel = owner|miembro activo).
  -- Filtro: `m.left_at IS NULL` (miembro activo) + `p.archived_at IS NULL`
  -- (sin places archivados/purgados). NO filtra por subscription_status: el
  -- payload incluye ACTIVE + PAYMENT_PENDING + INACTIVATION_PROCESS +
  -- INACTIVE (spec §"Badges + acciones por estado" — el frontend filtra las
  -- ACCIONES por status, pero el card siempre se muestra con badge si ≠ ACTIVE).
  -- Orden: owner-first (is_owner DESC) + alfabético case-insensitive dentro
  -- de cada grupo (lower(name) ASC). El ORDER BY vive dentro de jsonb_agg
  -- para que el array final ya venga ordenado.
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',           p.id,
        'slug',         p.slug,
        'name',         p.name,
        -- theme_config canónico = {colors: {accent, bg, ink}} (json-shapes.ts).
        -- Si por alguna razón estuviera `{}` (default crudo), el ->> retorna
        -- NULL y el frontend cae a un color default (responsabilidad del
        -- slice UI, no de la DB).
        'theme_accent', p.theme_accent,
        'status',       p.status,
        'is_owner',     p.is_owner,
        'joined_at',    p.joined_at
      )
      ORDER BY p.is_owner DESC, lower(p.name) ASC
    ),
    '[]'::jsonb
  )
  INTO v_places
  FROM (
    SELECT
      p.id,
      p.slug,
      p.name,
      p.theme_config->'colors'->>'accent' AS theme_accent,
      p.subscription_status::text AS status,
      EXISTS (
        SELECT 1 FROM place_ownership po
        WHERE po.place_id = p.id AND po.user_id = v_user_id
      ) AS is_owner,
      m.joined_at
    FROM membership m
    JOIN place p ON p.id = m.place_id
    WHERE m.user_id = v_user_id
      AND m.left_at IS NULL
      AND p.archived_at IS NULL
  ) p;

  RETURN jsonb_build_object('displayName', v_display_name, 'places', v_places);
END;
$$;--> statement-breakpoint

-- EXECUTE sólo app_system (no PUBLIC): el hub jamás se invoca por un rol no
-- previsto. Idempotente.
REVOKE EXECUTE ON FUNCTION app.get_inbox_payload() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.get_inbox_payload() TO "app_system";
