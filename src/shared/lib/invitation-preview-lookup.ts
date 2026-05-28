import { cache } from "react";
import { z } from "zod";

import { pool } from "@/db/client";
import { log } from "@/shared/lib/observability/log";

// Feature E — Invite Accept Flow V1.2 · Sesión B (ADR-0046 §D2). Wrapper TS
// sobre `app.invitation_preview` (migration 0003, SECURITY DEFINER —
// anonymous-safe per ADR-0010 §2: el token ES la capability). Pensado para
// `(marketing)/[locale]/login/page.tsx` cuando `?invite={token}` está
// presente, para derivar el `placeName` + `placeSlug` que enriquecen el
// branding apex del `<AccessFlow>` ("Te invitan a unirte a {placeName}",
// ADR-0046 §D2 + §D3).
//
// ## ¿Por qué un helper nuevo si ya existe `getInvitationMetaByToken`?
//
// `getInvitationMetaByToken` (`(app)/place/[placeSlug]/invite/[token]/_lib/`)
// hace 2 cosas: lookup del DEFINER + cross-place tampering check usando el
// `placeSlug` del URL. El `/login` apex NO tiene placeSlug en su URL — sólo
// el token. Tampering check ahí es estructuralmente imposible (no hay
// expected slug contra qué comparar). Por eso este helper hace SÓLO lookup
// + parse, sin tampering branch. Mantenerlos separados evita acoplar la
// responsabilidad "branding apex" con "consent point invite page".
//
// ## Anti-info-leak
//
// CUALQUIER fallo colapsa a `null` sin discriminator (vs el otro helper que
// distingue `not-found | cross-place-tampering | ok` porque su consumer
// necesita decidir UX). El consumer `/login` solo necesita "renderizar
// branding o no" — un boolean derivado. No leakeamos "este token existe
// pero venció" a un attacker que enumere tokens en `/login?invite=xxx`.
//
// Colapsan a null:
//   - Token shape inválido (no es 32-256 lowercase hex).
//   - Token normalizado vacío.
//   - DEFINER no encontró match (token inexistente / vencido / usado).
//   - Drift de schema (campos NULL inesperados, tipos drift TS↔DB).
//   - Red caída / pool exhaustion / timeout.
//
// ## Memoización per-request via React.cache
//
// Argumento PRIMITIVO (`token: string`) → React.cache deduplica intra-render
// por identity de string (===). Múltiples invocaciones del helper con el
// mismo token en el mismo render comparten una sola query Neon iad1. Misma
// técnica que `lookupCustomDomainBySlug` (Sesión A) y
// `getPlaceLocaleFallback`.
//
// ## Invariantes
//
//   1. Token shape gate: `^[a-f0-9]{32,256}$`. Co-definido con
//      `INVITE_PATH_PATTERN` (`shared/lib/sso/validate-login-return-to.ts`),
//      `TOKEN_PATTERN` (`get-invitation-meta-by-token.ts`),
//      `acceptInvitationSchema` (`features/invitations/actions/_lib/schemas.ts`).
//      Si cambia uno, revisar los otros tres.
//   2. Normalización: trim + lowercase. Defense + cache key uniformity.
//   3. Zod parse del payload (3 campos non-empty string). Si CUALQUIER campo
//      falla → null + log.
//   4. Fail-safe: todo error de DB → null + log.error (ADR-0047). NUNCA throw.

const TOKEN_PATTERN = /^[a-f0-9]{32,256}$/;

const previewSchema = z.object({
  place_slug: z.string().min(1),
  place_name: z.string().min(1),
  invitee_email: z.string().min(1),
});

interface PreviewRow {
  place_slug: unknown;
  place_name: unknown;
  invitee_email: unknown;
}

export interface InvitationPreview {
  placeSlug: string;
  placeName: string;
  inviteeEmail: string;
}

export const lookupInvitationPreview = cache(async (
  rawToken: string,
): Promise<InvitationPreview | null> => {
  const token = rawToken.trim().toLowerCase();
  if (!TOKEN_PATTERN.test(token)) return null;

  try {
    const result = await pool.query<PreviewRow>(
      "SELECT * FROM app.invitation_preview($1)",
      [token],
    );
    const row = result.rows[0];
    if (!row) return null;

    const parsed = previewSchema.safeParse(row);
    if (!parsed.success) {
      log.error(
        parsed.error,
        { scope: "invitation-preview-lookup" },
        "payload inválido",
      );
      return null;
    }

    return {
      placeSlug: parsed.data.place_slug,
      placeName: parsed.data.place_name,
      inviteeEmail: parsed.data.invitee_email,
    };
  } catch (err) {
    log.error(
      err,
      { scope: "invitation-preview-lookup" },
      "DB query falló",
    );
    return null;
  }
});
