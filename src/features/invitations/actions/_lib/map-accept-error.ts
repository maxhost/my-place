import type { AcceptInvitationError } from "../../types";

// Mapeo puro DEFINER error → discriminated union `AcceptInvitationError`.
// Espejo de migration 0030 (`app.accept_invitation`, body 0003 sin el cap
// 150/P0009 — ADR-0053 §6); SQLSTATEs son UNIQUE por error (distinto de V1
// create/revoke que reusan P0001 con regex(message)), así que
// switch-by-code basta. Unknown → `{kind:'unknown'}` (anti-info-leak: no
// propagamos texto crudo del driver al panel).

function readCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null) {
    const candidate = (err as { code?: unknown }).code;
    if (typeof candidate === "string") return candidate;
  }
  return undefined;
}

export function mapAcceptError(err: unknown): AcceptInvitationError {
  const code = readCode(err);
  switch (code) {
    case "28000":
      return { kind: "unauthenticated" };
    case "P0002":
      return { kind: "app_user_missing" };
    case "P0005":
      return { kind: "not_found" };
    case "P0006":
      return { kind: "expired" };
    case "P0007":
      return { kind: "already_used" };
    case "P0008":
      return { kind: "email_mismatch" };
    default:
      return { kind: "unknown" };
  }
}
