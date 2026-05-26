import { describe, expect, it } from "vitest";

import {
  createInvitationSchema,
  revokeInvitationSchema,
} from "../schemas";

// Tests puros (sin DB, sin next/headers) de los 2 zod schemas que las
// Server Actions del slice `invitations` usan como primera red de
// defense-in-depth. Schemas son `_lib/` privados del slice; las actions
// los consumen vía import directo. Sí se exportan los tipos `…Input`
// desde `_lib/` porque las actions los re-exportan en su signature.
//
// Cobertura V1: happy + cada rama de fail relevante. Strings de error
// son zod-internos (NO superficie public); las actions colapsan zod fail
// a tags discriminables (`invalid_email`, `invalid_expires`).

describe("createInvitationSchema (wrap app.create_invitation)", () => {
  it("happy: {placeId, email valid, expiresInDays 7} → success", () => {
    const result = createInvitationSchema.safeParse({
      placeId: "place_abc123",
      email: "newcomer@example.com",
      expiresInDays: 7,
    });
    expect(result.success).toBe(true);
  });

  it("invalid_email: 'no-arroba' → fail (no toca DB)", () => {
    const result = createInvitationSchema.safeParse({
      placeId: "place_abc123",
      email: "no-arroba",
      expiresInDays: 7,
    });
    expect(result.success).toBe(false);
  });

  it("invalid_expires below: expiresInDays = 0 → fail", () => {
    const result = createInvitationSchema.safeParse({
      placeId: "place_abc123",
      email: "ok@example.com",
      expiresInDays: 0,
    });
    expect(result.success).toBe(false);
  });

  it("invalid_expires above: expiresInDays = 91 → fail", () => {
    const result = createInvitationSchema.safeParse({
      placeId: "place_abc123",
      email: "ok@example.com",
      expiresInDays: 91,
    });
    expect(result.success).toBe(false);
  });
});

describe("revokeInvitationSchema (wrap app.revoke_invitation)", () => {
  it("happy: {invitationId} → success", () => {
    const result = revokeInvitationSchema.safeParse({
      invitationId: "inv_xyz789",
    });
    expect(result.success).toBe(true);
  });
});
