import { describe, expect, it } from "vitest";

import {
  createInvitationSchema,
  elevateToOwnerSchema,
  removeMemberSchema,
  revokeInvitationSchema,
  revokeOwnershipSchema,
  transferFounderOwnershipSchema,
  updateMyHeadlineSchema,
} from "../schemas";

// Tests puros (sin DB, sin next/headers) de los 3 zod schemas que las
// Server Actions de S7 usan como primera red de defense-in-depth (CLAUDE.md
// §"Zod para todo input externo"). Los schemas son `_lib/` privado del slice;
// las actions los consumen vía import directo. Sí se exportan los tipos
// `…Input` desde `_lib/` porque las actions los re-exportan en su signature.
//
// Cobertura V1: happy + cada rama de fail relevante. Los strings de error
// son zod-internos (NO superficie public); las actions colapsan zod fail a
// tags discriminables (`invalid_email`, `invalid_expires`, `too_long`).

describe("createInvitationSchema (S7, wrap app.create_invitation)", () => {
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

describe("revokeInvitationSchema (S7, wrap app.revoke_invitation)", () => {
  it("happy: {invitationId} → success", () => {
    const result = revokeInvitationSchema.safeParse({
      invitationId: "inv_xyz789",
    });
    expect(result.success).toBe(true);
  });
});

describe("updateMyHeadlineSchema (S7, wrap app.update_my_headline)", () => {
  it("happy 280: 'a'.repeat(280) → success (boundary)", () => {
    const result = updateMyHeadlineSchema.safeParse({
      placeId: "place_abc123",
      headline: "a".repeat(280),
    });
    expect(result.success).toBe(true);
  });

  it("too_long: 'a'.repeat(281) → fail (no toca DB)", () => {
    const result = updateMyHeadlineSchema.safeParse({
      placeId: "place_abc123",
      headline: "a".repeat(281),
    });
    expect(result.success).toBe(false);
  });

  it("null y '' ambos pasan (clear headline + empty string)", () => {
    const nullResult = updateMyHeadlineSchema.safeParse({
      placeId: "place_abc123",
      headline: null,
    });
    expect(nullResult.success).toBe(true);

    const emptyResult = updateMyHeadlineSchema.safeParse({
      placeId: "place_abc123",
      headline: "",
    });
    expect(emptyResult.success).toBe(true);
  });
});

// S8 schemas — 4 actions wrap sobre DEFINERs Feature E/D. Shape canónico
// `{placeId, targetUserId}` para las 4. Validación zod app-side = identidad
// estructural (strings no vacíos); la DEFINER hace la validación semántica.

describe("removeMemberSchema (S8, wrap app.remove_member)", () => {
  it("happy: {placeId, targetUserId} → success", () => {
    const result = removeMemberSchema.safeParse({
      placeId: "place_abc",
      targetUserId: "usr_xyz",
    });
    expect(result.success).toBe(true);
  });

  it("placeId vacío → fail (zod .min(1))", () => {
    const result = removeMemberSchema.safeParse({
      placeId: "",
      targetUserId: "usr_xyz",
    });
    expect(result.success).toBe(false);
  });
});

describe("elevateToOwnerSchema (S8, wrap app.elevate_to_owner)", () => {
  it("happy → success", () => {
    const result = elevateToOwnerSchema.safeParse({
      placeId: "place_abc",
      targetUserId: "usr_xyz",
    });
    expect(result.success).toBe(true);
  });

  it("targetUserId vacío → fail", () => {
    const result = elevateToOwnerSchema.safeParse({
      placeId: "place_abc",
      targetUserId: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("revokeOwnershipSchema (S8, wrap app.revoke_ownership)", () => {
  it("happy → success", () => {
    const result = revokeOwnershipSchema.safeParse({
      placeId: "place_abc",
      targetUserId: "usr_xyz",
    });
    expect(result.success).toBe(true);
  });

  it("placeId vacío → fail", () => {
    const result = revokeOwnershipSchema.safeParse({
      placeId: "",
      targetUserId: "usr_xyz",
    });
    expect(result.success).toBe(false);
  });
});

describe("transferFounderOwnershipSchema (S8, wrap app.transfer_founder_ownership)", () => {
  it("happy → success", () => {
    const result = transferFounderOwnershipSchema.safeParse({
      placeId: "place_abc",
      targetUserId: "usr_xyz",
    });
    expect(result.success).toBe(true);
  });

  it("targetUserId vacío → fail", () => {
    const result = transferFounderOwnershipSchema.safeParse({
      placeId: "place_abc",
      targetUserId: "",
    });
    expect(result.success).toBe(false);
  });
});
