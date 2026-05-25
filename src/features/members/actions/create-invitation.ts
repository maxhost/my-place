"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";

import type { InviteError } from "../types";
import { mapInviteError } from "./_lib/map-invite-error";
import {
  type CreateInvitationInput,
  createInvitationSchema,
} from "./_lib/schemas";

// Server Action S7 — wrap sobre `app.create_invitation` (migration 0018).
// Pattern canónico ADR-0034: getAuthenticatedDbForRequest + zod + DEFINER
// + map error + revalidatePath. Wiring delgado: la lógica testeable está en
// `_lib/` (puro, cubierto por vitest); este archivo es seam-split cross-
// system (next/headers + Neon Auth + DB) verificado por typecheck + smoke S12.
//
// Result shape: `{ok: true, invitationId, token}` ⇒ el caller arma el link
// `https://<host>/invite/<token>` UI-side. `{ok: false, error}` ⇒ tag
// discriminado de `InviteError` (types.ts §InviteError) que la UI rama por
// switch exhaustivo.
//
// Revalidate: `/[placeSlug]/settings/members` — recarga la tab Pendientes
// para que la invitación recién creada aparezca. El path sin placeSlug en
// el subpath (canon URLs públicas son subdomain — feedback memorizado);
// pero `revalidatePath` SÍ usa `/${placeSlug}/...` (canon revalidatePath).

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
