import { z } from "zod";

// Zod schemas puros (sin DB, sin next/headers) que las Server Actions de
// este slice usan como primera red de defense-in-depth (CLAUDE.md §"Zod
// para todo input externo"). Viven en `_lib/` porque también son la SoT
// del shape del payload (`…Input` tipos abajo) re-exportada por la action
// en su signature pública — el split mantiene la action ≤ 60 LOC.
//
// Slice diet S10.5-S10.8 — los schemas extraídos viven en slices hermanos:
//   - `place-ownership-actions/actions/_lib/schemas.ts` (S10.5 Plan B,
//     S10.6 ADR-0040): slice ELIMINADO por ADR-0054 — los 3 schemas de
//     ownership (elevate/revoke/transfer) ya no existen.
//   - `invitations/actions/_lib/schemas.ts` (S10.7 ADR-0041):
//     `createInvitationSchema`, `revokeInvitationSchema`.
//   - `member-profile/actions/_lib/schemas.ts` (S10.8 ADR-0042):
//     `updateMyHeadlineSchema`.

// S8 schema — wrap sobre `app.remove_member` (migration 0020, Feature E S5).
// Shape `{placeId, targetUserId}`; asimetría caller/target la resuelve la
// DEFINER (caller via claim de Neon Auth; target via parámetro). La DEFINER
// preserva la signature canónica `(p_target_user_id text, p_place_id text)`
// — target primero, place segundo. Validación zod app-side = identidad
// estructural (strings no vacíos); la DEFINER hace la validación semántica.

export const removeMemberSchema = z.object({
  placeId: z.string().min(1),
  targetUserId: z.string().min(1),
});

export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;
