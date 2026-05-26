"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";

import type { RevokeInviteError } from "../types";
import { mapRevokeInviteError } from "./_lib/map-revoke-error";
import {
  type RevokeInvitationInput,
  revokeInvitationSchema,
} from "./_lib/schemas";

// Wrap sobre `app.revoke_invitation` (migration 0019). Pattern canónico
// ADR-0034. DELETE físico (capability cesa de existir — la DEFINER retorna
// void; caller no necesita el row).

export type RevokeInvitationResult =
  | { ok: true }
  | { ok: false; error: RevokeInviteError };

export async function revokeInvitationAction(
  input: RevokeInvitationInput,
  placeSlug: string,
): Promise<RevokeInvitationResult> {
  const parsed = revokeInvitationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "generic" };

  try {
    await getAuthenticatedDbForRequest((sql) =>
      sql(`SELECT app.revoke_invitation($1)`, [parsed.data.invitationId]),
    );

    revalidatePath(`/${placeSlug}/settings/members`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: mapRevokeInviteError(err) };
  }
}
