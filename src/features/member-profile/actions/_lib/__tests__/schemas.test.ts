import { describe, expect, it } from "vitest";

import { updateMyHeadlineSchema } from "../schemas";

// Tests puros (sin DB, sin next/headers) del zod schema que la Server
// Action `updateMyHeadlineAction` usa como primera red de defense-in-depth
// (CLAUDE.md §"Zod para todo input externo"). Extracción S10.8 ADR-0042
// desde `members/actions/_lib/__tests__/schemas.test.ts`.
//
// Cobertura V1: happy + cada rama de fail relevante. Los strings de error
// son zod-internos (NO superficie public); la action colapsa zod fail a
// tags discriminables (`too_long`).

describe("updateMyHeadlineSchema (wrap app.update_my_headline)", () => {
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
