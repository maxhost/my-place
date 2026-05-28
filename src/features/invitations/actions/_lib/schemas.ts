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

// Para `acceptInvitationAction` (V1.1, wrap `app.accept_invitation` 0003).
// `token` ∈ [32, 256] chars: el runtime actual genera 64-hex (32 bytes
// crypto.randomBytes), pero el slot original aceptaba longitudes
// flexibles → min 32 (entropía mínima razonable), max 256 (defense
// contra payload abuse). Format NO se valida (ADR-0010 §2: el token es
// capability opaca, el formato no agrega seguridad — la DEFINER decide).
//
// Pre-Phase-1.C el shape incluía `placeSlug` optional (lo enviaba el panel
// para un `revalidatePath` post-success). El `revalidatePath` se dropeó en
// V1.2 Sesión D.fix.4 (race-condition con la navegación post-success — ver
// `accept-invitation.ts` §"Por qué NO revalidatePath") → el campo quedó
// no-usado por ~1 ciclo y se elimina en 1.C (cleanup tech-debt-pre-v1.3).
// El cross-place tampering check sigue viviendo en el RSC pre-call vía
// `get-invitation-meta-by-token` (DEFINER no recibe `placeSlug`).
export const acceptInvitationSchema = z.object({
  token: z.string().min(32).max(256),
});

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
