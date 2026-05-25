import type { SqlExecutor } from "@/shared/lib/db";
import type { PendingInvitation } from "../types";

// Query foundation slice `members` para el tab "Pendientes" de
// `/settings/members` (Feature E S6). El page de S11 lo invoca dentro de
// `getAuthenticatedDbForRequest(...)` (ADR-0034).
//
// Filtra sólo invitaciones ACCIONABLES (V1 spec.md §"Casos de uso V1"
// + tests.md §S6 T3): `accepted_at IS NULL AND expires_at > now()`. Las
// aceptadas ya produjeron membership (out of this list); las expiradas
// pueden purgar eventualmente (V1 no hay job de purga — sólo no se
// renderean).
//
// RLS aplica naturalmente: `invitation_all` es FOR ALL owner-only
// (`ownerOnly(t.placeId)`, schema/index.ts:269). Caller no-owner ⇒
// query retorna `[]` sin throw (consistente con loadMembers para no
// owners; fail-soft canónico del slice).
//
// JOIN `app_user` para resolver `invited_by` → `invitedByDisplayName`.
// Útil en multi-owner: cuando 2+ owners invitan, la UI muestra quién
// invitó a quién ("alice invitó a bob@x.com"). El JOIN es INNER porque
// `invitation.invited_by` es NOT NULL por schema; el app_user del
// invitador siempre existe (canon: app_user lifecycle nunca borra fila —
// tombstoned_at lo marca pero la fila persiste para preservar FKs
// históricos, ontologia §"Cuatro — Derecho al olvido estructurado").
//
// Ordenamiento: `expires_at ASC` (más urgentes primero). UX rationale:
// el owner ve primero lo que vence pronto — útil para revocar o
// re-emitir antes de la caducidad.
//
// Volumen V1: <100 pending por place en operación normal; sin
// pagination. Si V2+ habilita auto-bulk-invite, agregar limit/offset.
//
// NO expone `token` (es la capability — la UI sólo necesita identificar
// la fila para revoke + mostrar caducidad). Para re-generar un link
// copiable, el owner re-crea la invitación (mismo email + nueva fecha) —
// V1.1+ podría agregar "copiar link" sobre invitación existente.

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
