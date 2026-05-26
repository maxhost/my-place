import type { SqlExecutor } from "@/shared/lib/db";
import type { PendingInvitation } from "../types";

// Carga invitaciones ACCIONABLES (no aceptadas, no expiradas) ordenadas
// por urgencia (`expires_at ASC`). Filtra `accepted_at IS NULL AND
// expires_at > now()`: aceptadas ya produjeron membership; expiradas no
// se renderean (V1 sin job de purga). RLS owner-only via `invitation_all`
// (`ownerOnly(t.placeId)`) ⇒ caller no-owner retorna `[]` sin throw
// (fail-soft canónico, idéntico a loadMembers). JOIN INNER `app_user`
// (invited_by NOT NULL) provee `invitedByDisplayName` — útil multi-owner.
// NO expone `token` (capability — re-crear invitación si owner necesita
// link nuevo). Volumen V1 <100/place; sin pagination.

// Shape crudo de la SELECT con aliases. Tipado local para el cast del
// SqlExecutor genérico.
type LoadedPendingInvitationRow = {
  invitationId: string;
  email: string;
  expiresAt: Date;
  invitedByDisplayName: string;
};

/**
 * Carga las invitaciones pending (no aceptadas, no expiradas) del place.
 * RLS owner-only ⇒ caller no-owner retorna `[]` sin throw.
 *
 * El `executor` debe venir de `getAuthenticatedDbForRequest(...)` —
 * patrón canónico zone-aware (ADR-0034). Llamar con executor sin claim
 * → `[]` (mismo path que caller no-owner).
 */
export async function loadPendingInvitations(
  executor: SqlExecutor,
  placeId: string,
): Promise<PendingInvitation[]> {
  const rows = (await executor(
    `SELECT i.id              AS "invitationId",
            i.email            AS "email",
            i.expires_at       AS "expiresAt",
            au.display_name    AS "invitedByDisplayName"
       FROM invitation i
       JOIN app_user au ON au.id = i.invited_by
      WHERE i.place_id = $1
        AND i.accepted_at IS NULL
        AND i.expires_at > now()
      ORDER BY i.expires_at ASC`,
    [placeId],
  )) as LoadedPendingInvitationRow[];
  return rows.map((r) => ({
    invitationId: r.invitationId,
    email: r.email,
    expiresAt: r.expiresAt,
    invitedByDisplayName: r.invitedByDisplayName,
  }));
}
