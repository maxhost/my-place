// SoT canónica de tipos del slice `members-ownership` (Feature E V1, S10.5).
// Slice hermano de `members/` — extracción Plan B (plan-sesiones §S8 nota
// LOC + §S10 pre-commit checklist) para mantener slices bajo el cap heurístico
// (CLAUDE.md §"Límites de tamaño": feature ≤ 1500 LOC). Contiene los wrappers
// de las **3 DEFINER Feature D reutilizadas** (`app.elevate_to_owner`,
// `app.revoke_ownership`, `app.transfer_founder_ownership`) que coordinan
// transiciones del slot `place_ownership`. Las membresías (join/leave/remove)
// quedan en `members/` (slice core).
//
// Por qué slice separado y no sub-carpeta de `members/`:
//
// - **Cohesión por capability**: ownership es un slot del schema (fila en
//   `place_ownership` con FK a `app_user.id`) ortogonal a `membership`.
//   Las 3 actions tocan EXCLUSIVAMENTE ese slot; el founder slot
//   (`place.founder_user_id`) se mueve atómicamente en transfer.
// - **Acoplamiento bajo con `members/`**: solo `members/ui/` (S10) consume
//   estas actions — vía `@/features/members-ownership/public`. Cross-slice
//   limpio (paradigma vertical-slice `docs/architecture.md` §17-25).
// - **Reversibilidad**: si V1.1+ agrega más operaciones de ownership
//   (delegación, expiry de ownership temporal, etc.), el slice crece en
//   sí mismo sin contaminar `members/`.
//
// Decisiones canónicas que estos tipos materializan (heredadas de
// `members/types.ts` pre-split):
//
// - **Sin columna `role` en `membership`** (ADR-0002 §1, ADR-0035 §1): la
//   "rol" se deriva de `isOwner` + `isFounder` (booleans en `Member`,
//   `members/types.ts`). Estos errors son strings discriminables que la
//   UI rama por `switch` exhaustivo para mostrar copy i18n.
// - **Founder ⇒ owner por invariante** (ADR-0035 §2): la combinación
//   `isFounder=true AND isOwner=false` es estructuralmente imposible
//   (`app.transfer_founder_ownership` mueve ambos atómicos). Los wrappers
//   y la UI pueden asumirlo.
// - **Anti-info-leak**: los strings DEFINER son internals de DB y NO se
//   exponen al cliente. Los maps `_lib/map-*-error.ts` colapsan regex
//   (message) → tag; desconocidos → `'generic'` (canon ADR-0010).
//
// Locked durante S10.5-S12: ampliar este archivo requiere revisión explícita.

/**
 * Errores de `elevateToOwnerAction` (S8, wrap sobre `app.elevate_to_owner`
 * migration 0014 — Feature D, reutilizada).
 *
 * - `place_not_found`: DEFINER P0001 'place not found' — placeId no
 *   existe (caso edge, el wizard lo crea siempre).
 * - `target_not_member`: DEFINER P0001 'target is not an active member'
 *   — target no tiene membership activa (debe joinear primero).
 * - `target_already_owner`: DEFINER P0001 'target is already an owner'
 *   — idempotent, UI ⇒ refresh.
 */
export type ElevateError =
  | "unauthorized"
  | "not_owner"
  | "place_not_found"
  | "target_not_member"
  | "target_already_owner"
  | "generic";

/**
 * Errores de `revokeOwnershipAction` (S8, wrap sobre `app.revoke_ownership`
 * migration 0015 — Feature D, reutilizada).
 *
 * - `target_not_owner`: DEFINER P0001 'target is not an owner of this
 *   place' — target ya no tiene ownership (idempotent, UI ⇒ refresh).
 * - `cannot_revoke_founder`: DEFINER P0001 'cannot revoke founder
 *   ownership' — usar `transferFounderOwnershipAction` primero.
 * - `cannot_self_revoke`: DEFINER P0001 'cannot self-revoke ownership;
 *   use transfer or future step-down'. V1 sin auto-step-down.
 * - `last_owner`: DEFINER P0001 'cannot revoke the only remaining owner'
 *   — invariante ADR-0035 §2 (al menos 1 owner siempre).
 */
export type RevokeError =
  | "unauthorized"
  | "not_owner"
  | "target_not_owner"
  | "cannot_revoke_founder"
  | "cannot_self_revoke"
  | "last_owner"
  | "generic";

/**
 * Errores de `transferFounderOwnershipAction` (S8, wrap sobre
 * `app.transfer_founder_ownership` migration 0016 — Feature D, reutilizada).
 *
 * - `not_founder`: DEFINER P0001 'caller is not the founder of this
 *   place' — sólo el founder puede transferir (co-owners no).
 * - `target_not_owner`: DEFINER P0001 'target is not an owner; elevate
 *   first' — target debe ser owner antes de recibir el founder slot.
 * - `cannot_transfer_to_self`: DEFINER P0001 'cannot transfer to self'.
 * - `place_not_found`: DEFINER P0001 'place not found'.
 */
export type TransferError =
  | "unauthorized"
  | "not_founder"
  | "place_not_found"
  | "target_not_owner"
  | "cannot_transfer_to_self"
  | "generic";
