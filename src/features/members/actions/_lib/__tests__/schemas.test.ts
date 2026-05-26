import { describe, expect, it } from "vitest";

import { removeMemberSchema, updateMyHeadlineSchema } from "../schemas";

// Tests puros (sin DB, sin next/headers) de los 2 zod schemas que las
// Server Actions de este slice usan como primera red de defense-in-depth
// (CLAUDE.md §"Zod para todo input externo"). Los schemas son `_lib/`
// privado del slice; las actions los consumen vía import directo. Sí se
// exportan los tipos `…Input` desde `_lib/` porque las actions los
// re-exportan en su signature.
//
// Cobertura V1: happy + cada rama de fail relevante. Los strings de error
// son zod-internos (NO superficie public); las actions colapsan zod fail
// a tags discriminables (`too_long`).
//
// Slice diet S10.7 — tests de los 2 invitations schemas
// (`createInvitationSchema`, `revokeInvitationSchema`) viven en
// `src/features/invitations/actions/_lib/__tests__/schemas.test.ts`
// (extracción ADR-0041).

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

// S8 schema — wrap sobre `app.remove_member` (migration 0020, Feature E S5).
// Shape `{placeId, targetUserId}`; validación zod = identidad estructural.
//
// Slice diet — tests de schemas extraídos viven en slices hermanos:
//   - `place-ownership-actions/actions/_lib/__tests__/schemas.test.ts`
//     (S10.5 Plan B): los 3 schemas del slot ownership.
//   - `invitations/actions/_lib/__tests__/schemas.test.ts` (S10.7
//     ADR-0041): los 2 schemas del slot invitations.

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
