// SoT canónica de tipos del slice `members` (Feature E V1, S6). Consumido
// por queries (`./queries/load-members`), Server Actions (`./actions/{
// remove-member,update-my-headline}`) y UI (`./ui/{members-list,member-row-
// actions-menu,headline-editor}`). Re-exportado por `./public.ts` para
// consumers cross-feature (page `/settings/members` + futuras integraciones).
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
//   Server Action wrapper retorna un Result `{ok: true, …} | {ok: false,
//   error: <ErrorUnion>}`. Los strings de cada union son la superficie
//   public-stable que la UI rama por `switch` exhaustivo. Los wrappers
//   maps regex(message)→tag; los message strings DEFINER son internals de
//   DB y NO se exponen al cliente (canon ADR-0010 §"errores discriminables",
//   anti-info-leak).
//
// Slice diet S10.5-S10.8: este file quedó con `Member` + `MemberRole` +
// `getMemberRole` + `RemoveMemberError`. Los tipos extraídos viven en
// slices hermanos capability-named:
//   - `place-ownership-actions/types.ts` (S10.5 Plan B, renombrado en
//     S10.6 ADR-0040): slice ELIMINADO por ADR-0054 (un place = un
//     owner) — `ElevateError`/`RevokeError`/`TransferError` ya no existen.
//   - `invitations/types.ts` (S10.7 ADR-0041): `PendingInvitation`,
//     `InviteError`, `RevokeInviteError` — el slot `invitation`
//     (migrations 0018-0019). 2 errors V1 + 1 shape de query.
//   - `member-profile/types.ts` (S10.8 ADR-0042): `HeadlineError` —
//     capability perfil contextual del miembro (V1 = headline; reserva
//     avatar contextual V1.1+).
//
// 1 error V1 en este slice (`RemoveMemberError`) + 1 helper puro de
// derivación de rol.

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

// Los 3 errors del slot ownership (`ElevateError`, `RevokeError`, `TransferError`)
// se eliminaron junto con el slice `place-ownership-actions/` (ADR-0054,
// un place = un owner — ver header).
//
// Los tipos del slot invitations (`PendingInvitation`, `InviteError`,
// `RevokeInviteError`) se movieron a `src/features/invitations/types.ts`
// (extracción S10.7 ADR-0041).
//
// `HeadlineError` se movió a `src/features/member-profile/types.ts`
// (extracción S10.8 ADR-0042).
//
// Consumidores cross-slice los importan desde los `public.ts` respectivos
// (regla ESLint ADR-0039 — sin deep-imports cross-slice).
