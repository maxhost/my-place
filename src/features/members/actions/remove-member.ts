"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";

import type { RemoveMemberError } from "../types";
import { mapRemoveMemberError } from "./_lib/map-remove-member-error";
import { type RemoveMemberInput, removeMemberSchema } from "./_lib/schemas";

// Server Action S8 — wrap sobre `app.remove_member` (migration 0020, Feature E
// S4). Pattern canónico ADR-0034: getAuthenticatedDbForRequest + zod + DEFINER
// + map error + revalidatePath. Wiring delgado: la lógica testeable está en
// `_lib/` (puro, cubierto por vitest); este archivo es seam-split cross-
// system (next/headers + Neon Auth + DB) verificado por typecheck + smoke S12.
//
// Soft-remove: UPDATE `membership.left_at = now()` (preserva fila + historial).
// Bloquea remove de owners (separation of concerns con revoke_ownership) +
// bloquea self-remove V1 (V1.1+ tendrá `app.leave_place`). El DEFINER
// signature canónica Feature D/E es `(p_target_user_id, p_place_id)` —
// target primero, place segundo.

export type RemoveMemberResult =
  | { ok: true }
  | { ok: false; error: RemoveMemberError };

export async function removeMemberAction(
  input: RemoveMemberInput,
  placeSlug: string,
): Promise<RemoveMemberResult> {
  const parsed = removeMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "generic" };

  try {
    await getAuthenticatedDbForRequest((sql) =>
      sql(`SELECT app.remove_member($1, $2)`, [
        parsed.data.targetUserId,
        parsed.data.placeId,
      ]),
    );

    revalidatePath(`/place/${placeSlug}/settings/members`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: mapRemoveMemberError(err) };
  }
}
