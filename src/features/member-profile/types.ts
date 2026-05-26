// SoT canónica de tipos del slice `member-profile` (extracción S10.8
// ADR-0042 desde `members/types.ts`). Cohesión: capability autónoma del
// perfil contextual del miembro en este place — V1 abarca `headline`
// (bio contextual self-only, ADR-0036); V1.1+ extiende con avatar
// contextual + cualquier otro campo de perfil-en-place.
//
// 1 error union (1 por DEFINER consumida) — superficie public-stable;
// el map `_lib/` regex(message)→tag y los strings DEFINER son internals
// DB (anti-info-leak, ADR-0010).

/**
 * Errores de `updateMyHeadlineAction` (wrap sobre `app.update_my_headline`
 * migration 0017).
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
