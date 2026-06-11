"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";

import type { RevokeError } from "../types";
import { mapRevokeOwnershipError } from "./_lib/map-revoke-ownership-error";
import {
  type RevokeOwnershipInput,
  revokeOwnershipSchema,
} from "./_lib/schemas";

// Server Action S8 — wrap sobre `app.revoke_ownership` (migration 0015,
// Feature D S3 — reutilizada por Feature E). DELETE de `place_ownership`
// del target. La DEFINER bloquea: revoke del founder (usar transfer primero),
// self-revoke V1, last_owner (invariante ADR-0035: al menos 1 owner siempre).
// La `membership` del target se preserva (spec §"Remoción de owner ≠
// expulsión del place").

export type RevokeOwnershipResult =
  | { ok: true }
  | { ok: false; error: RevokeError };

export async function revokeOwnershipAction(
  input: RevokeOwnershipInput,
  placeSlug: string,
): Promise<RevokeOwnershipResult> {
  const parsed = revokeOwnershipSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "generic" };

  try {
    await getAuthenticatedDbForRequest((sql) =>
      sql(`SELECT app.revoke_ownership($1, $2)`, [
        parsed.data.targetUserId,
        parsed.data.placeId,
      ]),
    );

    revalidatePath(`/place/${placeSlug}/settings/members`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: mapRevokeOwnershipError(err) };
  }
}
