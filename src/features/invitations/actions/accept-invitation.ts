"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";

import type { AcceptInvitationError } from "../types";
import { mapAcceptError } from "./_lib/map-accept-error";
import {
  type AcceptInvitationInput,
  acceptInvitationSchema,
} from "./_lib/schemas";

// Wrap sobre `app.accept_invitation` (migration 0003 prod). Pattern canónico
// ADR-0034: getAuthenticatedDbForRequest + zod + DEFINER + map error. La
// DEFINER retorna `text` (slug del place aceptado) en success — el panel lo
// usa como redirect target (`https://{slug}.place.community/`). Tampering
// check (placeSlug URL ↔ invitation.place_id) vive en el RSC pre-call
// (`get-invitation-meta-by-token`, S3) — la action confía en el flow.
//
// `revalidatePath` SÍ usa el path zona-place `/${placeSlug}/invite/${token}`
// (canon revalidatePath, distinto de URLs públicas que van por subdomain) —
// post-success invalida el cache del invite page para que un re-visit
// renderice 404 (token ya consumido por la DEFINER, no preview).

export type AcceptInvitationResult =
  | { status: "success"; placeSlug: string }
  | { status: "error"; error: AcceptInvitationError };

export async function acceptInvitationAction(
  input: AcceptInvitationInput,
): Promise<AcceptInvitationResult> {
  const parsed = acceptInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: { kind: "unknown" } };
  }

  const { token, placeSlug } = parsed.data;

  try {
    const rows = (await getAuthenticatedDbForRequest((sql) =>
      sql(`SELECT app.accept_invitation($1) AS slug`, [token]),
    )) as Array<{ slug: string }>;

    const acceptedSlug = rows[0]?.slug;
    if (!acceptedSlug) {
      return { status: "error", error: { kind: "unknown" } };
    }

    if (placeSlug) {
      revalidatePath(`/${placeSlug}/invite/${token}`);
    }
    return { status: "success", placeSlug: acceptedSlug };
  } catch (err) {
    return { status: "error", error: mapAcceptError(err) };
  }
}
