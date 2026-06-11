// Interfaz pública del slice `place-ownership-actions` (Feature E V1, S10.5,
// paradigma vertical-slice `docs/architecture.md` §17-25): los demás
// features / rutas (page `/[placeSlug]/(place)/settings/members` S11 +
// consumers cross-slice) importan SÓLO desde acá, nunca de internals.
//
// Slice hermano de `members/` — extracción Plan B aplicada en S10.5
// (plan-sesiones §S8 nota LOC + §S10 pre-commit checklist). Concentra los
// 3 wrappers de las DEFINER Feature D reutilizadas (`app.elevate_to_owner`,
// `app.revoke_ownership`, `app.transfer_founder_ownership`) — operaciones
// del slot `place_ownership` ortogonal al slot `membership` (Feature E core).
//
// Cohesión por capability:
//   - 3 actions (elevate/revoke/transfer): SELECT app.<fn>($1, $2) wrappers
//     `(p_target_user_id, p_place_id)` con `revalidatePath('/place/[slug]/
//     settings/members')` post-success.
//   - 3 maps `_lib/` puros (DEFINER message → error tag discriminable) +
//     sus tests vitest (cobertura por rama).
//   - 3 schemas zod `_lib/` (identidad estructural: strings no vacíos) +
//     sus tests vitest. Los `…Input` types son la SoT del shape público.
//   - 3 error unions discriminables (`ElevateError`, `RevokeError`,
//     `TransferError`) que la UI rama por `switch` exhaustivo.
//
// Consumers cross-slice S10.5 (sólo lectura):
//   - `members/ui/members-list.tsx` y `members/ui/member-row-actions-menu.tsx`
//     importan las 3 actions + 3 error types desde acá (seam-split: las
//     reciben como props; el page S11 inyecta `*Action` real, los tests
//     RTL inyectan `vi.fn()`).
//
// Lo que NO se exporta (intencional):
//   - Maps `_lib/map-*-error.ts` puros — internos al slice; cualquier
//     consumer cross-feature usa las actions, no los maps.
//   - Schemas zod `_lib/schemas.ts` — la SoT del shape público son los
//     `…Input` types re-exportados, no los schemas.

export {
  elevateToOwnerAction,
  type ElevateToOwnerResult,
} from "./actions/elevate-to-owner";
export {
  revokeOwnershipAction,
  type RevokeOwnershipResult,
} from "./actions/revoke-ownership";
export {
  transferFounderOwnershipAction,
  type TransferFounderOwnershipResult,
} from "./actions/transfer-founder-ownership";

export type {
  ElevateToOwnerInput,
  RevokeOwnershipInput,
  TransferFounderOwnershipInput,
} from "./actions/_lib/schemas";

export type {
  ElevateError,
  RevokeError,
  TransferError,
} from "./types";
