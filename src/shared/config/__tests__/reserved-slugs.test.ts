import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, isReservedSlug } from "@/shared/config/reserved-slugs";

// Lista canónica: docs/multi-tenancy.md § Reservados.
const DOCUMENTED = [
  "app",
  "www",
  "api",
  "admin",
  "staging",
  "dev",
  "test",
] as const;

describe("reserved-slugs (multi-tenancy.md § Reservados)", () => {
  it("incluye todos los slugs documentados", () => {
    for (const slug of DOCUMENTED) {
      expect(RESERVED_SLUGS).toContain(slug);
    }
  });

  it("isReservedSlug rechaza los documentados", () => {
    for (const slug of DOCUMENTED) {
      expect(isReservedSlug(slug)).toBe(true);
    }
  });

  it("isReservedSlug es case-insensitive y tolera espacios", () => {
    expect(isReservedSlug("ADMIN")).toBe(true);
    expect(isReservedSlug("  Api  ")).toBe(true);
  });

  it("no marca como reservado un slug válido de place", () => {
    expect(isReservedSlug("lucia-yoga")).toBe(false);
    expect(isReservedSlug("club-del-libro")).toBe(false);
  });
});
