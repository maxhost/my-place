-- Slice `members` (2.G): defensa en profundidad del invariante "max 150 miembros activos por place".
-- Ver docs/features/members/spec.md § Invariantes + docs/blueprint.md § "máximo 150".
--
-- El chequeo de dominio (`assertPlaceHasCapacity`) ya ocurre en `acceptInvitationAction` y en
-- `inviteMemberAction` — esta migración agrega la red de seguridad en DB para cubrir cualquier
-- bypass: ejecuciones SQL directas, seeds, migraciones futuras, otro servicio tocando la tabla.
--
-- Implementación: trigger BEFORE INSERT ON "Membership" que cuenta memberships activas (leftAt IS NULL)
-- en el place receptor y aborta si ya hay 150. También cubre el caso `UPDATE` que reactiva una
-- membership (setea `leftAt` de NOT NULL → NULL) — un "re-join" vía UPDATE no debe bypasear el cap.
--
-- NO se dispara en UPDATE donde `leftAt` cambia de NULL → NOT NULL (es una salida, reduce el count)
-- ni en updates que no tocan `leftAt` (ej: cambio de rol).

CREATE OR REPLACE FUNCTION enforce_place_capacity()
RETURNS TRIGGER AS $$
DECLARE
  active_count INT;
  max_members CONSTANT INT := 150;
BEGIN
  -- Solo chequear cuando el row resultante queda como "miembro activo".
  IF NEW."leftAt" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- En UPDATE: si ya estaba activo (leftAt IS NULL antes y después), no hubo incorporación neta.
  IF TG_OP = 'UPDATE' AND OLD."leftAt" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO active_count
    FROM "Membership"
    WHERE "placeId" = NEW."placeId"
      AND "leftAt" IS NULL;

  IF active_count >= max_members THEN
    RAISE EXCEPTION 'place_capacity_exceeded: place % ya tiene % miembros activos (máximo %)',
      NEW."placeId", active_count, max_members
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER membership_capacity_check
  BEFORE INSERT OR UPDATE OF "leftAt" ON "Membership"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_place_capacity();
