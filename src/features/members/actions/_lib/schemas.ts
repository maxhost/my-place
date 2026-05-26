import { z } from "zod";

// Zod schemas puros (sin DB, sin next/headers) que las Server Actions de
// S7 usan como primera red de defense-in-depth (CLAUDE.md §"Zod para todo
// input externo"). Se viven en `_lib/` porque también son la SoT del shape
// del payload (`…Input` tipos abajo) re-exportada por la action en su
// signature pública — el split mantiene la action ≤ 60 LOC.
//
// Defense-in-depth con las DEFINER de DB (migrations 0017/0018/0019):
//
// - `email` valid (zod) primero, sino: `app.create_invitation` igual lo
//   inserta como string opaco (la DEFINER NO valida formato — comment
//   migration 0018 §"Email passthrough"). zod rechaza antes ⇒ NO toca DB.
// - `expiresInDays` ∈ [1, 90] (zod) primero, sino: la DEFINER calcula
//   `now() + days` y rechaza con P0001 si quedó ≤ now(). zod rechaza antes
//   ⇒ NO toca DB. 90 días como techo soft V1 (decisión spec §CU2; V2+
//   evaluar custom long-lived).
// - `headline` length ≤ 280 (zod) primero, sino: el CHECK constraint
//   `membership_headline_length_chk` (migration 0017) rechaza con 23514.
//   zod rechaza antes ⇒ NO toca DB. Nullable explícito: `null` clear
//   headline (set NULL), `''` headline vacío válido (length 0 satisface
//   max 280; el CHECK también acepta '' porque sólo verifica length).
//
// **No-trim policy en `headline`**: NO se aplica `.trim()` porque whitespace
// significativo en la bio contextual es decisión del usuario (e.g. emoji
// padding, formato custom). El DB no normaliza tampoco — input = output.

export const createInvitationSchema = z.object({
  placeId: z.string().min(1),
  email: z.email(),
  expiresInDays: z.number().int().min(1).max(90),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const revokeInvitationSchema = z.object({
  invitationId: z.string().min(1),
});

export type RevokeInvitationInput = z.infer<typeof revokeInvitationSchema>;

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
//
// S10.5 — los 3 schemas del slot ownership (`elevateToOwnerSchema`,
// `revokeOwnershipSchema`, `transferFounderOwnershipSchema`) + sus Input
// types se movieron a `src/features/place-ownership-actions/actions/_lib/schemas.ts`
// (extracción Plan B).

export const removeMemberSchema = z.object({
  placeId: z.string().min(1),
  targetUserId: z.string().min(1),
});

export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;
