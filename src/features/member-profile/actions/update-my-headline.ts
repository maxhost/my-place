"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";

import type { HeadlineError } from "../types";
import { mapHeadlineError } from "./_lib/map-headline-error";
import {
  type UpdateMyHeadlineInput,
  updateMyHeadlineSchema,
} from "./_lib/schemas";

// Server Action S7 — wrap sobre `app.update_my_headline` (migration 0017).
// Pattern canónico ADR-0034: getAuthenticatedDbForRequest + zod + DEFINER
// + map error + revalidatePath. Wiring delgado sobre `_lib/`.
//
// Self-edit only (ADR-0036 §3): la DEFINER NO acepta `p_target_user_id` —
// siempre escribe sobre el caller. El input acá NO incluye `targetUserId`
// por la misma razón (el wrapper TS preserva el contract canónico).
//
// `null` ⇒ clear headline (set NULL). `''` ⇒ empty string valid (length 0
// satisface max 280 + CHECK constraint).

export type UpdateMyHeadlineResult =
  | { ok: true }
  | { ok: false; error: HeadlineError };

export async function updateMyHeadlineAction(
  input: UpdateMyHeadlineInput,
  placeSlug: string,
): Promise<UpdateMyHeadlineResult> {
  const parsed = updateMyHeadlineSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    if (firstIssue?.path[0] === "headline") {
      return { ok: false, error: "too_long" };
    }
    return { ok: false, error: "generic" };
  }

  try {
    await getAuthenticatedDbForRequest((sql) =>
      sql(`SELECT app.update_my_headline($1, $2)`, [
        parsed.data.placeId,
        parsed.data.headline,
      ]),
    );

    revalidatePath(`/${placeSlug}/settings/members`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: mapHeadlineError(err) };
  }
}
