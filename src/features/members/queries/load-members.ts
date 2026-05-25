import type { SqlExecutor } from "@/shared/lib/db";
import type { Member } from "../types";

// Query foundation slice `members` (Feature E S6). El page de S11
// (`/[placeSlug]/(place)/settings/members/page.tsx` RSC) lo invoca dentro
// de `getAuthenticatedDbForRequest(...)` (ADR-0034) — el `SqlExecutor`
// viene con el claim del caller inyectado tx-local; la query corre
// SECURITY INVOKER bajo la RLS.
//
// RLS aplica naturalmente:
//   - `membership_sel` (owner-only via `ownerOnly(t.placeId)`,
//     schema/index.ts:214) filtra el JOIN base: caller no-owner → 0 filas.
//   - `po_sel` (`app.current_user_owns_place(t.placeId)`,
//     schema/index.ts:246) filtra el LEFT JOIN a `place_ownership`:
//     caller no-owner → todas las po rows son NULL.
//   - `place_sel` (`ownerOnly(t.id)`, schema/index.ts:137) filtra el JOIN
//     a `place` para leer `founder_user_id`: caller no-owner → place
//     fila NULL → INNER JOIN deja 0 filas (mismo resultado).
// Resultado: caller no-owner del place ⇒ array vacío (sin throw). El page
// consumer lo tratará como "no autorizado" (redirect 404 o estado vacío,
// decisión del page en S11).
//
// `isOwner` derivado de `po.user_id IS NOT NULL`. `isFounder` derivado de
// `m.user_id = p.founder_user_id`. Founder ⇒ owner por invariante
// estructural ADR-0035 §2 (transfer_founder_ownership mueve founder slot
// + ownership atómicos); la query NO re-valida la implicación —
// `getMemberRole` (types.ts) hace fail-loud si recibe la combinación
// imposible `isFounder=true AND isOwner=false`.
//
// Ordenamiento: `joined_at DESC` (más nuevos primero, V1). UX rationale:
// el owner ve primero a los que recién se sumaron — útil para revisar
// alta de miembros recientes. V1.1+ podría agregar filter/sort UI.
// Cap implícito: 150 miembros por place (invariante data-model.md) → no
// pagination V1; carga completa en una SELECT.
//
// NO usa stored function: query trivial sobre tablas con JOINs estándar
// + RLS hace el guard. Mismo patrón que `loadPlaceBySlug` (settings S3):
// SELECT directo con alias snake→camel via `AS "..."`. Lo opuesto al
// patrón `getInboxPayload` que SÍ usa DEFINER por consolidar acceso
// cross-tenant.

// Shape crudo de la SELECT con aliases. El SqlExecutor devuelve
// `Record<string, unknown>[]`; lo tipamos acá para el cast localmente.
type LoadedMemberRow = {
  userId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  headline: string | null;
  joinedAt: Date;
  isOwner: boolean;
  isFounder: boolean;
};

/**
 * Carga los miembros activos del place (membresía con `left_at IS NULL`)
 * con identidad universal + flags de rol derivados. RLS owner-only:
 * caller no-owner ⇒ `[]` (sin throw).
 *
 * El `executor` debe venir de `getAuthenticatedDbForRequest(...)` —
 * patrón canónico zone-aware (ADR-0034). Llamar con executor sin claim
 * → array vacío (mismo path que caller no-owner; el page trata `[]`
 * como "no autorizado/no existe").
 */
export async function loadMembers(
  executor: SqlExecutor,
  placeId: string,
): Promise<Member[]> {
  const rows = (await executor(
    `SELECT m.user_id                            AS "userId",
            au.display_name                       AS "displayName",
            au.handle                             AS "handle",
            au.avatar_url                         AS "avatarUrl",
            m.headline                            AS "headline",
            m.joined_at                           AS "joinedAt",
            (po.user_id IS NOT NULL)              AS "isOwner",
            (m.user_id = p.founder_user_id)       AS "isFounder"
       FROM membership m
       JOIN app_user au ON au.id = m.user_id
       JOIN place p     ON p.id = m.place_id
       LEFT JOIN place_ownership po
              ON po.user_id = m.user_id
             AND po.place_id = m.place_id
      WHERE m.place_id = $1
        AND m.left_at IS NULL
      ORDER BY m.joined_at DESC`,
    [placeId],
  )) as LoadedMemberRow[];
  return rows.map((r) => ({
    userId: r.userId,
    displayName: r.displayName,
    handle: r.handle,
    avatarUrl: r.avatarUrl,
    headline: r.headline,
    joinedAt: r.joinedAt,
    isOwner: r.isOwner,
    isFounder: r.isFounder,
  }));
}
