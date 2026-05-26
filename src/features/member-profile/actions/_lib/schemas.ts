import { z } from "zod";

// Zod schemas puros (sin DB, sin next/headers) que las Server Actions del
// slice `member-profile` usan como primera red de defense-in-depth
// (CLAUDE.md §"Zod para todo input externo"). Extracción S10.8 ADR-0042
// desde `members/actions/_lib/schemas.ts`.
//
// Defense-in-depth con la DEFINER `app.update_my_headline` (migration 0017):
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

export const updateMyHeadlineSchema = z.object({
  placeId: z.string().min(1),
  headline: z.string().max(280).nullable(),
});

export type UpdateMyHeadlineInput = z.infer<typeof updateMyHeadlineSchema>;
