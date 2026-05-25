// SoT canónica de tipos del slice `members` (Feature E V1, S6). Consumido
// por queries (`./queries/*`, S6), Server Actions (`./actions/*`, S7-S8) y
// UI (`./ui/*`, S9-S10). Re-exportado por `./public.ts` para consumers
// cross-feature (page `/settings/members` + futuras integraciones).
//
// Decisiones canónicas que estos tipos materializan:
//
// - **Sin columna `role` en `membership`** (ADR-0002 §1 refinada por
//   ADR-0035 §1): la "rol" de un usuario en un place se DERIVA. `Member`
//   transporta `isOwner` + `isFounder` como booleans — esa es la SoT. La
//   etiqueta unificada `MemberRole` ('founder'|'owner'|'member') es una
//   proyección para UI (badges, copy i18n), derivable vía `getMemberRole`.
//
// - **Founder ⇒ owner por invariante** (ADR-0035 §2): el founder slot
//   apunta a un `app_user.id` que SIEMPRE tiene fila en `place_ownership`
//   (`app.transfer_founder_ownership` mueve ambos atómicamente). No
//   modelamos un Member con `isFounder=true AND isOwner=false` — esa
//   combinación es estructuralmente imposible y los wrappers/UI pueden
//   asumirlo.
//
// - **Error unions por capability** (1 por DEFINER consumida): cada
//   Server Action wrapper (S7-S8) retorna un Result `{ok: true, …} |
//   {ok: false, error: <ErrorUnion>}`. Los strings de cada union son la
//   superficie public-stable que la UI rama por `switch` exhaustivo. Los
//   wrappers maps regex(message)→tag; los message strings DEFINER son
//   internals de DB y NO se exponen al cliente (canon ADR-0010 §"errores
//   discriminables", anti-info-leak).
//
// Locked durante S7-S12: ampliar este archivo requiere revisión explícita
// (regla plan-sesiones §S7 §S8 §S9-S11). El alcance V1 está cerrado por
// las 3 DEFINER nuevas de Feature E (S2/S3/S4) + 1 DEFINER S1 (headline);
// las 3 DEFINER de Feature D reutilizadas (elevate/revoke/transfer) viven
// en el slice hermano `src/features/members-ownership/` (extracción Plan B
// S10.5 — ver `members-ownership/types.ts` para `ElevateError`,
// `RevokeError`, `TransferError`). 4 errors V1 en este slice + 1 helper
// de derivación.

/**
 * Miembro activo del place (fila en `membership` con `left_at IS NULL`).
 *
 * Shape canónico que `loadMembers` retorna y que la UI consume. Los
 * booleans `isOwner`/`isFounder` son SoT — `MemberRole` es derivada.
 *
 * - `userId`: PK opaca de `app_user.id`. Usada como key React + payload
 *   de las Server Actions (target_user_id).
 * - `displayName` / `handle` / `avatarUrl`: identidad universal del user
 *   (JOIN `app_user`). `avatarUrl` puede ser `null` (usuario sin foto).
 * - `headline`: bio contextual del miembro PARA ESTE place (ADR-0036).
 *   `null` ⇒ no setteada; UI renderiza condicionalmente (sin placeholder
 *   pasivo, decisión ADR-0036 §1).
 * - `joinedAt`: timestamp de alta en este place. Ordenamiento default de
 *   la lista (DESC — más nuevos primero, V1).
 * - `isOwner`: true si existe fila en `place_ownership` para este par
 *   (user, place). Founder ⇒ owner por invariante; co-owner ⇒ owner;
 *   miembro común ⇒ false.
 * - `isFounder`: true si `membership.user_id == place.founder_user_id`.
 *   Implica `isOwner=true` por invariante ADR-0035 §2.
 */
export type Member = {
  userId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  headline: string | null;
  joinedAt: Date;
  isOwner: boolean;
  isFounder: boolean;
};

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
 * Etiqueta derivada del rol de un miembro en su place. Proyección para
 * UI/i18n — NO es el SoT (los booleans `isOwner`/`isFounder` de `Member`
 * lo son). Mapeo canónico:
 *
 * - `'founder'`: `isFounder && isOwner` (única combinación posible para
 *   founder por invariante ADR-0035 §2).
 * - `'owner'`: `!isFounder && isOwner` (co-owner — owner que no fundó).
 * - `'member'`: `!isFounder && !isOwner` (miembro común, sin ownership).
 *
 * La combinación `isFounder && !isOwner` es estructuralmente imposible
 * (`app.transfer_founder_ownership` mueve founder + ownership atómicos);
 * `getMemberRole` no la contempla — si llegara, sería drift del schema y
 * fail-loud en runtime es preferible a render silencioso.
 */
export type MemberRole = "founder" | "owner" | "member";

/**
 * Deriva la etiqueta `MemberRole` de los booleans canónicos del `Member`.
 * Pura, sin I/O. Consumida por la UI de S10 (`<MembersList />` para
 * pickear `<Badge variant={role}>`).
 *
 * Fail-loud sobre `isFounder && !isOwner`: ese estado es estructuralmente
 * imposible (founder es owner siempre, ADR-0035 §2); si la query produce
 * eso, es señal de drift entre schema y código y vale más romper en dev
 * que pintar un badge incorrecto.
 */
export function getMemberRole(member: Member): MemberRole {
  if (member.isFounder && !member.isOwner) {
    throw new Error(
      `Member ${member.userId} viene con isFounder=true pero isOwner=false — invariante ADR-0035 §2 violado.`,
    );
  }
  if (member.isFounder) return "founder";
  if (member.isOwner) return "owner";
  return "member";
}

/**
 * Errores discriminables de `createInvitationAction` (S7, wrap sobre
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
 * Errores de `revokeInvitationAction` (S7, wrap sobre `app.revoke_invitation`
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
 * Errores de `removeMemberAction` (S8, wrap sobre `app.remove_member`
 * migration 0020).
 *
 * - `target_is_owner`: DEFINER P0001 'target is an owner; revoke
 *   ownership first'. Separation of concerns con `revokeOwnershipAction`.
 * - `cannot_self_remove`: DEFINER P0001 'cannot self-remove; use
 *   leave_place (V1.1+)'. V1 sin self-remove; V1.1+ habilita el endpoint.
 * - `target_not_active_member`: DEFINER P0001 'target is not an active
 *   member' — cubre uniformemente target sin membership + target con
 *   `left_at NOT NULL` (anti-info-leak sobre historial).
 */
export type RemoveMemberError =
  | "unauthorized"
  | "not_owner"
  | "target_is_owner"
  | "cannot_self_remove"
  | "target_not_active_member"
  | "generic";

/**
 * Errores de `updateMyHeadlineAction` (S7, wrap sobre
 * `app.update_my_headline` migration 0017).
 *
 * - `not_member`: DEFINER P0001 'caller is not an active member of this
 *   place'. UI ⇒ "no formás parte de este place".
 * - `too_long`: zod rechaza `length > 280` (defense-in-depth con CHECK
 *   constraint DB-side, ADR-0036). No toca DB.
 */
export type HeadlineError =
  | "unauthorized"
  | "not_member"
  | "too_long"
  | "generic";

// Los 3 errors del slot ownership (`ElevateError`, `RevokeError`, `TransferError`)
// se movieron a `src/features/members-ownership/types.ts` (extracción Plan B
// S10.5, ver header). Consumidores cross-slice los importan desde
// `@/features/members-ownership/public`.
