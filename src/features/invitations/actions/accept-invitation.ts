"use server";

import { getCurrentUserIdentityForRequest } from "@/shared/lib/current-user-identity";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";
import { ensureAppUser } from "@/shared/lib/ensure-app-user";
import { enforceRateLimit, getRequestIp } from "@/shared/lib/rate-limit";

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
// ## Identidad zone-aware (V1.2 Sesión D.fix.3, ADR-0046 §Addendum Sesión D.fix.3)
//
// Pre-D.fix.3 leíamos identity con `getAuth().getSession()` (Neon Auth SDK).
// Bug B del smoke 2x2 V1.2: en custom domain, el SDK SOLO lee la cookie
// `Domain=.place.community` — NO la cookie local SSO `__Host-place_sso_
// session`. Resultado: action retornaba `unauthenticated` aunque el invitee
// tuviera sesión activa post SSO-chain en `nocodecompany.co`. Mismo gap
// arquitectónico que D.fix.1/D.fix.2 cerraron para readers RSC, ahora aplicado
// al Server Action.
//
// `getCurrentUserIdentityForRequest()` (`shared/lib/current-user-identity.ts`)
// usa el coordinator zone-aware (ADR-0034) y devuelve `{authUserId, email,
// displayName}` atómico: los 3 campos derivan del MISMO `claims.sub` dentro
// de una sola TX. Esto strictly mejora vs pre-D.fix.3: en el pattern viejo,
// email/displayName venían del SDK y `authUserId` de la TX del coordinator —
// teóricamente desincronizables si la sesión cambiara entre lookups (cerrado
// ahora con un único lookup atómico). Null → short-circuit `unauthenticated`
// (la DEFINER tiraría 28000 igual, pero ahorramos 2 round-trips).
//
// ## TX 2 — `app.accept_invitation`
//
// Retorna `text` (slug del place aceptado) en success — el panel lo usa como
// redirect target. Tampering check (placeSlug URL ↔ invitation.place_id) vive
// en el RSC pre-call (`get-invitation-meta-by-token`, S3) — la action confía.
//
// ## Por qué NO `revalidatePath` (V1.2 Sesión D.fix.4, 2026-05-27)
//
// Smoke matriz 2x2 V1.2 (escenario 4: custom domain × unlogged → signup)
// reveló Bug C: flash 404 visible por milisegundos entre click "Aceptar" y
// landing al Hub. Root cause: `revalidatePath('/${placeSlug}/invite/${token}')`
// disparaba `x-action-revalidated: 1` en el response Server Action, que hacía
// que Next.js incluya el RSC re-rendereado del invite page en el mismo stream
// de respuesta. El re-render llama `getInvitationMetaByToken` →
// `app.invitation_preview` retorna null (token recién consumido por TX 2) →
// `notFound()` → 404 page rendered en el client antes que el panel resuelva el
// await + invoque `window.location.assign(placeHomeUrl)`. Visible flash de 1
// frame por orden de eventos.
//
// El invariante que el `revalidatePath` intentaba preservar ("re-visit del
// invite URL post-accept renderiza 404, no preview cached") YA está garantizado
// por (a) `export const dynamic = 'force-dynamic'` en el page (re-render
// server-side cada visita) + (b) `app.invitation_preview` retorna null para
// tokens ya consumidos → `notFound()` natural. El `revalidatePath` era
// redundante (sólo invalida cache del router client-side, que se invalida
// igual al navegar a Hub) y activamente dañino por el race-condition con la
// navegación post-success.
//
// Fix: drop el `revalidatePath` + import `next/cache` huérfano. Cero cambio
// del contrato del action (sigue retornando `{status, placeSlug}`), cero
// cambio del panel (sigue navegando con `window.location.assign`).

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

  // Phase 0.D — rate limit por IP (5/min). Identifier IP (anti-abuse anon).
  // Pre-DB para no consumir TX1 (`ensureAppUser`) en intentos bloqueados.
  const ip = await getRequestIp();
  const gate = await enforceRateLimit("accept_invitation", ip);
  if (!gate.success) {
    const retryAfterSeconds = Math.max(
      1,
      Math.min(3600, Math.ceil((gate.resetAt - Date.now()) / 1000)),
    );
    return {
      status: "error",
      error: { kind: "rate_limited", retryAfterSeconds },
    };
  }

  // `placeSlug` del input queda ignorado post-D.fix.4 (era usado sólo por el
  // `revalidatePath` removido). El schema sigue aceptándolo para no romper el
  // contrato con el panel V1.1; cleanup eventual en V1.3.
  const { token } = parsed.data;

  try {
    const identity = await getCurrentUserIdentityForRequest();
    if (identity === null) {
      return { status: "error", error: { kind: "unauthenticated" } };
    }
    const { authUserId, email, displayName } = identity;

    await getAuthenticatedDbForRequest((sql) =>
      ensureAppUser(sql, { authUserId, email, displayName }),
    );

    const rows = (await getAuthenticatedDbForRequest((sql) =>
      sql(`SELECT app.accept_invitation($1) AS slug`, [token]),
    )) as Array<{ slug: string }>;

    const acceptedSlug = rows[0]?.slug;
    if (!acceptedSlug) {
      return { status: "error", error: { kind: "unknown" } };
    }

    return { status: "success", placeSlug: acceptedSlug };
  } catch (err) {
    return { status: "error", error: mapAcceptError(err) };
  }
}
