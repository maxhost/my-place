"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";
import { enforceRateLimit, getRequestIp } from "@/shared/lib/rate-limit";

import type { InviteError } from "../types";
import { mapInviteError } from "./_lib/map-invite-error";
import {
  type CreateInvitationInput,
  createInvitationSchema,
} from "./_lib/schemas";

// Wrap sobre `app.create_invitation` (migration 0018). Pattern canónico
// ADR-0034: getAuthenticatedDbForRequest + zod + DEFINER + map error +
// revalidatePath. Result `{ok: true, invitationId, token}` ⇒ caller arma
// `https://<host>/invite/<token>` UI-side; `{ok: false, error}` ⇒ tag
// discriminado de `InviteError`. revalidatePath SÍ usa `/${placeSlug}/...`
// (canon revalidatePath, distinto de URLs públicas que van por subdomain).

export type CreateInvitationResult =
  | { ok: true; invitationId: string; token: string }
  | { ok: false; error: InviteError };

export async function createInvitationAction(
  input: CreateInvitationInput,
  placeSlug: string,
): Promise<CreateInvitationResult> {
  const parsed = createInvitationSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    if (firstIssue?.path[0] === "email") {
      return { ok: false, error: "invalid_email" };
    }
    if (firstIssue?.path[0] === "expiresInDays") {
      return { ok: false, error: "invalid_expires" };
    }
    return { ok: false, error: "generic" };
  }

  const { placeId, email, expiresInDays } = parsed.data;
  const expiresAt = new Date(
    Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Phase 0.D — rate limit por IP+placeId (30/h). Identifier compuesto:
  // owner legítimo en batch sigue OK (30 invites/h); owner comprometido con
  // script no escala más allá del límite por place. Si V1.3 expone multi-
  // place admin, considerar derivar identifier de session/user en vez de IP.
  const ip = await getRequestIp();
  const gate = await enforceRateLimit("create_invitation", `${ip}:${placeId}`);
  if (!gate.success) {
    return { ok: false, error: "rate_limited" };
  }

  try {
    const rows = (await getAuthenticatedDbForRequest((sql) =>
      sql(`SELECT app.create_invitation($1, $2, $3::timestamptz) AS payload`, [
        placeId,
        email,
        expiresAt,
      ]),
    )) as Array<{ payload: { invitation_id: string; token: string } }>;

    const payload = rows[0]?.payload;
    if (!payload) return { ok: false, error: "generic" };

    revalidatePath(`/${placeSlug}/settings/members`);
    return {
      ok: true,
      invitationId: payload.invitation_id,
      token: payload.token,
    };
  } catch (err) {
    return { ok: false, error: mapInviteError(err) };
  }
}
