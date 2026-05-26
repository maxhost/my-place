"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";

import type { ElevateError } from "../types";
import { mapElevateError } from "./_lib/map-elevate-error";
import {
  type ElevateToOwnerInput,
  elevateToOwnerSchema,
} from "./_lib/schemas";

// Server Action S8 — wrap sobre `app.elevate_to_owner` (migration 0014,
// Feature D S2 — reutilizada por Feature E). Pattern canónico ADR-0034 +
// seam-split S7. INSERT en `place_ownership` para promover miembro activo
// a co-owner. La DEFINER cubre privilege escalation guards (caller is owner,
// target is active member, target NOT already owner).

export type ElevateToOwnerResult =
  | { ok: true }
  | { ok: false; error: ElevateError };

export async function elevateToOwnerAction(
  input: ElevateToOwnerInput,
  placeSlug: string,
): Promise<ElevateToOwnerResult> {
  const parsed = elevateToOwnerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "generic" };

  try {
    await getAuthenticatedDbForRequest((sql) =>
      sql(`SELECT app.elevate_to_owner($1, $2)`, [
        parsed.data.targetUserId,
        parsed.data.placeId,
      ]),
    );

    revalidatePath(`/${placeSlug}/settings/members`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: mapElevateError(err) };
  }
}
