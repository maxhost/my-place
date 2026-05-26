import { z } from "zod";

// Zod schemas puros (sin DB, sin next/headers) que las Server Actions de
// este slice usan como primera red de defense-in-depth (CLAUDE.md §"Zod
// para todo input externo"). Viven en `_lib/` porque también son la SoT
// del shape del payload (`…Input` tipos abajo) re-exportada por la action
// en su signature pública — el split mantiene la action ≤ 60 LOC.
//
// Defense-in-depth con las DEFINER de DB (migrations 0017/0020):
//
// - `headline` length ≤ 280 (zod) primero, sino: el CHECK constraint
//   `membership_headline_length_chk` (migration 0017) rechaza con 23514.
//   zod rechaza antes ⇒ NO toca DB. Nullable explícito: `null` clear
//   headline (set NULL), `''` headline vacío válido (length 0 satisface
//   max 280; el CHECK también acepta '' porque sólo verifica length).
//
// **No-trim policy en `headline`**: NO se aplica `.trim()` porque whitespace
// significativo en la bio contextual es decisión del usuario (e.g. emoji
// padding, formato custom). El DB no normaliza tampoco — input = output.
//
// Slice diet S10.5-S10.7 — los schemas extraídos viven en slices hermanos:
//   - `place-ownership-actions/actions/_lib/schemas.ts` (S10.5 Plan B,
//     S10.6 ADR-0040): `elevateToOwnerSchema`, `revokeOwnershipSchema`,
//     `transferFounderOwnershipSchema`.
//   - `invitations/actions/_lib/schemas.ts` (S10.7 ADR-0041):
//     `createInvitationSchema`, `revokeInvitationSchema`.

export const updateMyHeadlineSchema = z.object({
  placeId: z.string().min(1),
  headline: z.string().max(280).nullable(),
});

export type UpdateMyHeadlineInput = z.infer<typeof updateMyHeadlineSchema>;

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
