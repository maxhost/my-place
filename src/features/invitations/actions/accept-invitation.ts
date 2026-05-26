"use server";

import { revalidatePath } from "next/cache";
import { getAuth } from "@/shared/lib/auth";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";
import { ensureAppUser } from "@/shared/lib/ensure-app-user";

import type { AcceptInvitationError } from "../types";
import { mapAcceptError } from "./_lib/map-accept-error";
import {
  type AcceptInvitationInput,
  acceptInvitationSchema,
} from "./_lib/schemas";

// Wrap sobre `app.accept_invitation` (migration 0003 prod). Pattern canónico
// ADR-0034: getAuthenticatedDbForRequest + zod + DEFINER + map error.
//
// ## Pipeline 2-TX (S6 fix post-smoke 2026-05-26)
//
// El smoke E2E V1.1 reveló que post-signup el invitee no tiene `app_user`
// sembrado (ADR-0008 §2/§4: `signUpAccountAction` NO crea app_user — "cuenta
// sin place" es estado legítimo). El siembrado canon de `app_user` vive en
// `place-creation/actions.ts:sessionIdentity()` + `create-place.ts:71-77` —
// pero el invite Accept NO pasa por PlaceWizard. Sin seed, la DEFINER tira
// P0002 (app_user inexistente) que el panel muestra como "Algo salió mal".
//
// Fix: TX 1 separada de `ensureAppUser` antes de la TX 2 del DEFINER. Paralelo
// exacto al patrón `create-place.ts:65-77` (ADR-0005 §4): tx separadas para
// que rollback de TX 2 (e.g. P0007 race con otro accept del mismo token) NO
// borre el `app_user` recién sembrado. `ensureAppUser` es idempotente (ADR-
// 0006, ON CONFLICT DO NOTHING) → no-op si ya existía (caso login normal de
// un user existente).
//
// Identidad de la sesión: `getAuth().getSession()` espejo de
// `place-creation/actions.ts:33-45`. `claims.sub` viene del JWT verificado
// dentro de `getAuthenticatedDbForRequest` (el helper inyecta claims al
// callback) → identidad = la misma que RLS lee. Sin sesión → short-circuit
// `unauthenticated` (la DEFINER tiraría 28000 igual, pero ahorramos round-trip).
//
// ## TX 2 — `app.accept_invitation`
//
// Retorna `text` (slug del place aceptado) en success — el panel lo usa como
// redirect target. Tampering check (placeSlug URL ↔ invitation.place_id) vive
// en el RSC pre-call (`get-invitation-meta-by-token`, S3) — la action confía.
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
    const session = await getAuth().getSession();
    if (!session.data?.session) {
      return { status: "error", error: { kind: "unauthenticated" } };
    }
    const email = session.data.user.email ?? "";
    const displayName = session.data.user.name ?? "";

    await getAuthenticatedDbForRequest((sql, claims) =>
      ensureAppUser(sql, { authUserId: claims.sub, email, displayName }),
    );

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
