"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";

import type { TransferError } from "../types";
import { mapTransferError } from "./_lib/map-transfer-error";
import {
  type TransferFounderOwnershipInput,
  transferFounderOwnershipSchema,
} from "./_lib/schemas";

// Server Action S8 — wrap sobre `app.transfer_founder_ownership` (migration
// 0016, Feature D S4 — reutilizada por Feature E). Operación atómica:
// UPDATE `place.founder_user_id = target` + DELETE `place_ownership` del
// caller (caller pierde ownership pero conserva membership). Sólo el founder
// transfiere (asimetría ADR-0035 §Decisión 1). Target debe ser owner
// pre-existente (no transfer-without-successor — refuerzo del invariante).

export type TransferFounderOwnershipResult =
  | { ok: true }
  | { ok: false; error: TransferError };

export async function transferFounderOwnershipAction(
  input: TransferFounderOwnershipInput,
  placeSlug: string,
): Promise<TransferFounderOwnershipResult> {
  const parsed = transferFounderOwnershipSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "generic" };

  try {
    await getAuthenticatedDbForRequest((sql) =>
      sql(`SELECT app.transfer_founder_ownership($1, $2)`, [
        parsed.data.targetUserId,
        parsed.data.placeId,
      ]),
    );

    revalidatePath(`/place/${placeSlug}/settings/members`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: mapTransferError(err) };
  }
}
