// SoT canónica de tipos del slice `invitations` (extracción S10.7
// ADR-0041 desde `members/types.ts`). Cohesión: capability autónoma del
// slot `invitation` (migrations 0018-0019), ortogonal a `membership`
// (`members/`) y a `place_ownership` (`place-ownership-actions/`).
//
// 2 error unions (1 por DEFINER consumida) — superficie public-stable;
// los maps `_lib/` regex(message)→tag y los strings DEFINER son internals
// DB (anti-info-leak, ADR-0010).

/**
 * Invitación pendiente (no aceptada y no expirada) visible al owner del
 * place en el tab "Pendientes" de `/settings/members`.
 *
 * Shape canónico que `loadPendingInvitations` retorna. V1 NO expone el
 * `token` (es la capability — la UI sólo necesita identificar la fila
 * para revoke + mostrar caducidad). Para regenerar el link copiable, el
 * owner re-crea la invitación (mismo email + nueva fecha) — V1.1+
 * podría agregar "copiar link" sobre invitación existente.
 *
 * - `invitationId`: PK opaca de `invitation.id`. Pasada a
 *   `revokeInvitationAction`.
 * - `email`: email destinatario que el owner ingresó. Display-only —
 *   gating es por capability/token (ADR-0010 §2), NO por email lookup.
 * - `expiresAt`: timestamp de expiración. UI calcula "expira en 3 días"
 *   client-side via `Intl.RelativeTimeFormat`.
 * - `invitedByDisplayName`: nombre del owner que creó la invitación
 *   (JOIN `app_user`). Multi-owner ⇒ útil saber QUIÉN invitó (ej.:
 *   "alice invitó a bob@x.com").
 */
export type PendingInvitation = {
  invitationId: string;
  email: string;
  expiresAt: Date;
  invitedByDisplayName: string;
};

/**
 * Errores discriminables de `createInvitationAction` (wrap sobre
 * `app.create_invitation` migration 0018 + zod app-side).
 *
 * - `unauthorized`: caller sin sesión (DEFINER `28000`) o sin `app_user`
 *   (`P0002`). UI ⇒ "necesitás iniciar sesión".
 * - `not_owner`: caller no es owner del place (DEFINER P0001 'caller is
 *   not an owner of this place'). Cubre member-no-owner V1 + cross-place.
 * - `invalid_email`: zod rechaza formato — input no es email parseable.
 *   No toca DB. UI ⇒ error inline en el input.
 * - `invalid_expires`: zod rechaza `expiresInDays` fuera de [1, 90].
 *   No toca DB.
 * - `expires_in_past`: DEFINER P0001 'expires_at must be in the future'.
 *   Defense-in-depth: el cómputo zod `now() + days` siempre debería caer
 *   en el futuro, pero clock skew client/server podría disparar este.
 * - `generic`: cualquier otro fallo (red, 5xx, drift de schema).
 */
export type InviteError =
  | "unauthorized"
  | "not_owner"
  | "invalid_email"
  | "invalid_expires"
  | "expires_in_past"
  | "generic";

/**
 * Errores de `revokeInvitationAction` (wrap sobre `app.revoke_invitation`
 * migration 0019).
 *
 * - `not_found`: DEFINER P0001 'invitation not found' — token/id ya
 *   inválido (otro owner la revocó concurrentemente, o expiró + purga).
 * - `already_accepted`: DEFINER P0001 'cannot revoke already-accepted
 *   invitation'. UI ⇒ "esa invitación ya fue aceptada; usá 'remover
 *   miembro' para sacar a la persona".
 */
export type RevokeInviteError =
  | "unauthorized"
  | "not_owner"
  | "not_found"
  | "already_accepted"
  | "generic";

/**
 * Errores discriminables de `acceptInvitationAction` (wrap sobre
 * `app.accept_invitation` migration 0003 prod). Cada SQLSTATE de la
 * DEFINER mapea 1:1 a un `kind`. Discriminated union (vs string union de
 * V1 `InviteError`/`RevokeInviteError`) porque V2+ algunos kinds podrían
 * cargar payload extra (ej.: `place_full` con cupo actual) y porque la UI
 * de aceptación renderiza panels distintos por kind — el shape `{kind:…}`
 * mapea limpio al switch del panel.
 *
 * - `unauthenticated`: 28000 — caller sin sesión (no logueado).
 * - `app_user_missing`: P0002 — sesión Auth válida pero NO hay row en
 *   `app_user` (claim race / RLS gap). UI ⇒ "tu cuenta no terminó de
 *   crearse, intentá de nuevo".
 * - `not_found`: P0005 — token inexistente (no se generó / revocada / typo
 *   en URL). UI ⇒ "esta invitación no existe o fue revocada".
 * - `expired`: P0006 — invitación pasó su `expires_at`.
 * - `already_used`: P0007 — ya consumida (test-and-set perdedor o
 *   re-visit del mismo link).
 * - `email_mismatch`: P0008 — email del caller ≠ email del invitee
 *   (case/whitespace-insensitive vía DEFINER).
 * - `place_full`: P0009 — place alcanzó 150 miembros activos.
 * - `unknown`: cualquier otro SQLSTATE (drift, red, 5xx) — anti-info-leak.
 */
export type AcceptInvitationError =
  | { kind: "unauthenticated" }
  | { kind: "app_user_missing" }
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "already_used" }
  | { kind: "email_mismatch" }
  | { kind: "place_full" }
  | { kind: "unknown" };
