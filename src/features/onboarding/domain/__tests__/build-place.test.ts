import { describe, expect, it } from "vitest";
import { PAPEL_PALETTE, defaultOpeningHours } from "../defaults";
import {
  OnboardingDomainError,
  buildPlaceCreation,
} from "../build-place";

// Ensamblado puro: valida (Zod) → aplica defaults → corre guardrail →
// produce los args canónicos de `app.create_place` (S3) + avisos de
// guardrail. Sin DB ni SDK: 100% unit-testeable (S5a).

const base = {
  name: "Mi Comunidad",
  slug: "mi-comunidad",
  ownerTimezone: "America/Argentina/Buenos_Aires",
};

describe("defaults", () => {
  it("PAPEL_PALETTE = valores de marca de la landing", () => {
    expect(PAPEL_PALETTE).toEqual({
      accent: "#c4632f",
      bg: "#faf7f0",
      ink: "#1c1b22",
    });
  });

  it("defaultOpeningHours = 09:00–20:00 los 7 días en la tz dada", () => {
    const oh = defaultOpeningHours("Europe/Madrid");
    expect(oh.timezone).toBe("Europe/Madrid");
    for (const d of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const) {
      expect(oh.weekly[d]).toEqual([{ open: "09:00", close: "20:00" }]);
    }
  });
});

describe("buildPlaceCreation", () => {
  it("sin theme → default Papel; sin openingHours → default 09–20 en tz del owner", () => {
    const r = buildPlaceCreation(base);
    expect(r.themeConfig.colors).toEqual(PAPEL_PALETTE);
    expect(r.openingHours).toEqual(
      defaultOpeningHours("America/Argentina/Buenos_Aires"),
    );
    expect(r.slug).toBe("mi-comunidad");
    expect(r.name).toBe("Mi Comunidad");
    expect(r.description).toBeNull();
  });

  it("theme_config persiste SOLO los 3 tokens del owner (shape canónico)", () => {
    const r = buildPlaceCreation(base);
    expect(Object.keys(r.themeConfig)).toEqual(["colors"]);
    expect(Object.keys(r.themeConfig.colors).sort()).toEqual([
      "accent",
      "bg",
      "ink",
    ]);
  });

  it("guardrail: par ink/bg inaccesible → ajusta ink persistido + avisa", () => {
    const r = buildPlaceCreation({
      ...base,
      theme: { accent: "#c4632f", bg: "#faf7f0", ink: "#efe9dc" },
    });
    expect(r.themeConfig.colors.ink).not.toBe("#efe9dc");
    expect(r.adjustments.length).toBeGreaterThan(0);
    expect(r.adjustments.some((a) => a.token === "ink")).toBe(true);
  });

  it("guardrail nunca bloquea: devuelve resultado aun con paleta mala", () => {
    expect(() =>
      buildPlaceCreation({
        ...base,
        theme: { accent: "#777777", bg: "#757575", ink: "#767676" },
      }),
    ).not.toThrow();
  });

  it("description provista se trimea y persiste", () => {
    const r = buildPlaceCreation({ ...base, description: "  Para vecinos  " });
    expect(r.description).toBe("Para vecinos");
  });

  it("slug reservado → OnboardingDomainError mapeado (no ZodError crudo)", () => {
    try {
      buildPlaceCreation({ ...base, slug: "admin" });
      expect.unreachable("debió lanzar");
    } catch (e) {
      expect(e).toBeInstanceOf(OnboardingDomainError);
      expect((e as OnboardingDomainError).code).toBe("INVALID_PAYLOAD");
      expect((e as OnboardingDomainError).toUserMessage()).toMatch(/slug|reservad/i);
    }
  });

  it("payload malformado → OnboardingDomainError con field", () => {
    try {
      buildPlaceCreation({ ...base, name: "" });
      expect.unreachable("debió lanzar");
    } catch (e) {
      expect(e).toBeInstanceOf(OnboardingDomainError);
      expect((e as OnboardingDomainError).code).toBe("INVALID_PAYLOAD");
      expect((e as OnboardingDomainError).fields).toContain("name");
    }
  });

  it("es determinista: misma entrada → misma salida", () => {
    expect(buildPlaceCreation(base)).toEqual(buildPlaceCreation(base));
  });
});
