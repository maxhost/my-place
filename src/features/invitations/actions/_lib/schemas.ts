import { z } from "zod";

// Zod schemas puros (sin DB, sin next/headers) que las 2 Server Actions
// del slice `invitations` usan como primera red de defense-in-depth
// (CLAUDE.md §"Zod para todo input externo"). Viven en `_lib/` porque
// también son la SoT del shape del payload (`…Input` tipos abajo)
// re-exportada por la action en su signature pública — el split mantiene
// la action ≤ 60 LOC.
//
// Defense-in-depth con las DEFINER de DB (migrations 0018/0019):
//
// - `email` valid (zod) primero, sino: `app.create_invitation` igual lo
//   inserta como string opaco (la DEFINER NO valida formato — comment
//   migration 0018 §"Email passthrough"). zod rechaza antes ⇒ NO toca DB.
// - `expiresInDays` ∈ [1, 90] (zod) primero, sino: la DEFINER calcula
//   `now() + days` y rechaza con P0001 si quedó ≤ now(). zod rechaza antes
//   ⇒ NO toca DB. 90 días como techo soft V1 (decisión spec §CU2; V2+
//   evaluar custom long-lived).

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
