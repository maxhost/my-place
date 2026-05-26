import { pool } from "@/db/client";

// Helper integrator V1.1 S3 (Feature E Invite Accept Flow, ADR-0044
// §"Tampering check vive en RSC"). Envuelve `app.invitation_preview`
// (migration 0003, SECURITY DEFINER, anonymous-safe — el token ES la
// capability, ADR-0010 §2) y agrega el **cross-place tampering check**
// defense-in-depth que el DEFINER no puede hacer (no recibe el `placeSlug`
// del URL post-proxy).
//
// ## Anti-info-leak (spec §CU-Accept-1)
//
// CUALQUIER fallo de DB se colapsa a `{ kind: 'not-found' }`:
//   - Token inexistente (P0005).
//   - Vencido (P0006).
//   - Ya usado (P0007).
//   - Token malformado (no pasa el shape gate inicial).
//   - Drift de schema / red caída / pool exhaustion.
//
// La page lo trata como `notFound()` → 404 sin pistas de la causa. Defensa
// vs enumeration attack del keyspace de tokens (~256 bits si el token es
// 64-hex, infeasible — pero el principio de no-leakear razón cierra incluso
// el caso teórico de un attacker con muchos tokens semivalidos).
//
// ## Cross-place tampering (defense-in-depth)
//
// Vector: visitor abre `mi-place.place.community/invite/{token-de-otro-place}`.
// El proxy reescribe a `/place/mi-place/invite/{token}` — el `placeSlug` URL
// dice "mi-place", pero la invitación apunta a `otro-place`. El RSC compara
// `rows[0].place_slug` (autoridad: la DB) vs `placeSlug` (input: el URL).
// Si no matchean → `{ kind: 'cross-place-tampering' }`. La page lo trata
// como `notFound()` también (mismo anti-doxx — no leakear que "el token sí
// existe pero es de otro lugar").
//
// Por qué no en el DEFINER: requeriría agregar `p_expected_place_slug`,
// rompiendo el contrato existente (V1 consumers no lo pasarían) y entremezcla
// la responsabilidad. El check RSC es la capa correcta — el DEFINER asegura
// correctness DB (membership creada en el `place_id` correcto, no en el
// spoofed), el RSC asegura UX correctness (invitee no aterriza en la página
// equivocada). ADR-0044 §"tampering check vive en RSC" documenta in extenso.
//
// ## Token shape (defense-in-depth)
//
// Validación previa: 32-256 lowercase hex. El validator de returnTo
// (ADR-0033 V1.1, helper en `shared/lib/sso/validate-login-return-to.ts`)
// ya filtra en el flow round-trip apex→invite, pero un visitor directo via
// URL bookmark / DM share / typo bypassa ese filtro. Normalizar token
// malformado a `not-found` cierra el vector "el DEFINER recibe basura"
// sin levantar excepción extra.
//
// Co-definido con `acceptInvitationSchema` (`features/invitations/actions/
// _lib/schemas.ts`) y `INVITE_PATH_PATTERN` (`shared/lib/sso/validate-
// login-return-to.ts`): los 3 canónizan rango 32-256 hex. Si cambia uno,
// revisar los otros dos.

const TOKEN_PATTERN = /^[a-f0-9]{32,256}$/;

interface PreviewRow {
  place_slug: unknown;
  place_name: unknown;
  invitee_email: unknown;
}

export type InvitationMetaResult =
  | { kind: "not-found" }
  | { kind: "cross-place-tampering" }
  | { kind: "ok"; placeName: string; inviteeEmail: string };

export async function getInvitationMetaByToken(
  token: string,
  placeSlug: string,
): Promise<InvitationMetaResult> {
  if (!TOKEN_PATTERN.test(token)) return { kind: "not-found" };

  try {
    const result = await pool.query<PreviewRow>(
      "SELECT * FROM app.invitation_preview($1)",
      [token],
    );
    const row = result.rows[0];
    if (!row) return { kind: "not-found" };

    const dbSlug =
      typeof row.place_slug === "string" ? row.place_slug : null;
    const placeName =
      typeof row.place_name === "string" ? row.place_name : null;
    const inviteeEmail =
      typeof row.invitee_email === "string" ? row.invitee_email : null;

    if (dbSlug === null || placeName === null || inviteeEmail === null) {
      return { kind: "not-found" };
    }

    if (dbSlug !== placeSlug.trim().toLowerCase()) {
      return { kind: "cross-place-tampering" };
    }

    return { kind: "ok", placeName, inviteeEmail };
  } catch {
    return { kind: "not-found" };
  }
}
