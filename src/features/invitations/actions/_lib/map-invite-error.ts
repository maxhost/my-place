import type { InviteError } from "../../types";

// Mapeo puro DEFINER error → tag `InviteError`. Espejo de migration 0018
// (`app.create_invitation`); strings + codes son contract con DB — drift
// rompe test puro. Unknown → `'generic'` (anti-info-leak). `'unauthorized'`
// agrupa 28000 + P0002 (ambos "sesión rota" UX-side).

function readCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null) {
    const candidate = (err as { code?: unknown }).code;
    if (typeof candidate === "string") return candidate;
  }
  return undefined;
}

function readMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "";
}

export function mapInviteError(err: unknown): InviteError {
  const code = readCode(err);
  const message = readMessage(err);

  if (code === "28000" || code === "P0002") return "unauthorized";
  if (message.includes("caller is not an owner of this place")) {
    return "not_owner";
  }
  if (message.includes("expires_at must be in the future")) {
    return "expires_in_past";
  }
  return "generic";
}
