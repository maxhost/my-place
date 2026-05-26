import { z } from "zod";

// Zod schemas puros (sin DB, sin next/headers) que las 3 Server Actions del
// slice `place-ownership-actions` usan como primera red de defense-in-depth
// (CLAUDE.md §"Zod para todo input externo"). Extracción S10.5 desde
// `members/actions/_lib/schemas.ts` — sólo los 3 schemas del slot ownership
// se movieron acá; los 4 schemas del slice members (`createInvitation`,
// `revokeInvitation`, `updateMyHeadline`, `removeMember`) quedan allá.
//
// Las 3 DEFINER que estos schemas validan son **Feature D reutilizadas por
// Feature E**: `app.elevate_to_owner` (migration 0014), `app.revoke_ownership`
// (migration 0015), `app.transfer_founder_ownership` (migration 0016).
// Preservan la signature canónica `(p_target_user_id text, p_place_id text)`
// — target primero, place segundo.
//
// Validación zod app-side es **identidad estructural** (strings no vacíos);
// las DEFINERs hacen la validación semántica (existencia, ownership,
// invariantes). 3 schemas separados (en vez de un único `targetOnPlaceSchema`
// reutilizado) porque la SoT del shape del input es la action, y mantener
// tipos distintos permite que una evolución V2 de un endpoint específico
// (ej. add `reason: string` a transfer) no rompa los otros 2.

export const elevateToOwnerSchema = z.object({
  placeId: z.string().min(1),
  targetUserId: z.string().min(1),
});

export type ElevateToOwnerInput = z.infer<typeof elevateToOwnerSchema>;

export const revokeOwnershipSchema = z.object({
  placeId: z.string().min(1),
  targetUserId: z.string().min(1),
});

export type RevokeOwnershipInput = z.infer<typeof revokeOwnershipSchema>;

export const transferFounderOwnershipSchema = z.object({
  placeId: z.string().min(1),
  targetUserId: z.string().min(1),
});

export type TransferFounderOwnershipInput = z.infer<
  typeof transferFounderOwnershipSchema
>;
