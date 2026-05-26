import type { RevokeInviteError } from "../../types";

// Mapeo puro DEFINER error → tag `RevokeInviteError`. Espejo de migration
// 0019 (`app.revoke_invitation`). Unknown → `'generic'` (anti-info-leak).
// NO mapea P0002 (la DEFINER no hace lookup app_user — comment migration
// 0019); 28000 cubre auth; owner check colapsa el resto a `'not_owner'`.

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

export function mapRevokeInviteError(err: unknown): RevokeInviteError {
  const code = readCode(err);
  const message = readMessage(err);

  if (code === "28000") return "unauthorized";
  if (message.includes("invitation not found")) return "not_found";
  if (message.includes("caller is not an owner of this place")) {
    return "not_owner";
  }
  if (message.includes("cannot revoke already-accepted invitation")) {
    return "already_accepted";
  }
  return "generic";
}
