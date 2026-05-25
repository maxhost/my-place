import { describe, expect, it } from "vitest";

import {
  elevateToOwnerSchema,
  revokeOwnershipSchema,
  transferFounderOwnershipSchema,
} from "../schemas";

// Tests puros (sin DB, sin next/headers) de los 3 zod schemas que las
// Server Actions del slice `members-ownership` usan como primera red de
// defense-in-depth (CLAUDE.md §"Zod para todo input externo"). Cobertura V1:
// happy + cada rama de fail relevante. Shape canónico `{placeId, targetUserId}`
// para las 3; validación zod app-side = identidad estructural (strings no
// vacíos), la DEFINER hace la validación semántica.
//
// Extracción S10.5 desde `members/actions/_lib/__tests__/schemas.test.ts`.

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
