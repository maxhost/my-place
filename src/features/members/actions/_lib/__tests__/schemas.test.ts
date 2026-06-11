import { describe, expect, it } from "vitest";

import { removeMemberSchema } from "../schemas";

// Tests puros (sin DB, sin next/headers) del zod schema que la Server
// Action `removeMemberAction` usa como primera red de defense-in-depth
// (CLAUDE.md §"Zod para todo input externo").
//
// Slice diet — tests de schemas extraídos viven en slices hermanos:
//   - `place-ownership-actions/actions/_lib/__tests__/schemas.test.ts`
//     (S10.5 Plan B): eliminado junto con su slice (ADR-0054).
//   - `invitations/actions/_lib/__tests__/schemas.test.ts` (S10.7
//     ADR-0041): los 2 schemas del slot invitations.
//   - `member-profile/actions/_lib/__tests__/schemas.test.ts` (S10.8
//     ADR-0042): `updateMyHeadlineSchema`.

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
