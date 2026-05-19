import { describe, expect, it } from "vitest";
import {
  createPlaceInputSchema,
  openingHoursSchema,
  paletteSchema,
  slugSchema,
} from "../schema";

// Zod del payload de creación (CLAUDE.md: Zod para todo input externo).
// La verificación DURA de unicidad de slug NO está acá — es el UNIQUE de la
// DB (S1) vía la saga (S5b). Acá: formato subdominio + reservados (UX).

describe("slugSchema", () => {
  it("acepta slug válido y normaliza (trim + lowercase)", () => {
    expect(slugSchema.parse("  Mi-Place  ")).toBe("mi-place");
  });

  it("rechaza espacios y caracteres no permitidos", () => {
    expect(slugSchema.safeParse("mi place").success).toBe(false);
    expect(slugSchema.safeParse("mi_place").success).toBe(false);
    expect(slugSchema.safeParse("miplacé").success).toBe(false);
  });

  it("rechaza guion al inicio/fin y doble guion de borde", () => {
    expect(slugSchema.safeParse("-place").success).toBe(false);
    expect(slugSchema.safeParse("place-").success).toBe(false);
  });

  it("rechaza slug demasiado corto o demasiado largo (label DNS ≤63)", () => {
    expect(slugSchema.safeParse("ab").success).toBe(false);
    expect(slugSchema.safeParse("a".repeat(64)).success).toBe(false);
    expect(slugSchema.safeParse("a".repeat(63)).success).toBe(true);
  });

  it("rechaza slugs reservados (app, www, api, admin, staging, dev, test)", () => {
    for (const s of ["app", "www", "api", "admin", "staging", "dev", "test"]) {
      expect(slugSchema.safeParse(s).success).toBe(false);
    }
  });

  it("detecta el reservado tras normalizar (mayúsculas/espacios)", () => {
    expect(slugSchema.safeParse("  ADMIN ").success).toBe(false);
  });
});

describe("paletteSchema", () => {
  it("acepta hex de 6 dígitos y lo normaliza a lowercase", () => {
    expect(
      paletteSchema.parse({ accent: "#C4632F", bg: "#FAF7F0", ink: "#1C1B22" }),
    ).toEqual({ accent: "#c4632f", bg: "#faf7f0", ink: "#1c1b22" });
  });

  it("expande hex de 3 dígitos a 6", () => {
    expect(paletteSchema.parse({ accent: "#abc", bg: "#fff", ink: "#000" })).toEqual(
      { accent: "#aabbcc", bg: "#ffffff", ink: "#000000" },
    );
  });

  it("rechaza color no-hex y token faltante", () => {
    expect(
      paletteSchema.safeParse({ accent: "rojo", bg: "#fff", ink: "#000" }).success,
    ).toBe(false);
    expect(paletteSchema.safeParse({ accent: "#fff", bg: "#fff" }).success).toBe(
      false,
    );
  });
});

describe("openingHoursSchema", () => {
  const valid = {
    timezone: "America/Argentina/Buenos_Aires",
    weekly: {
      mon: [{ open: "09:00", close: "20:00" }],
      tue: [{ open: "09:00", close: "20:00" }],
      wed: [{ open: "09:00", close: "20:00" }],
      thu: [{ open: "09:00", close: "20:00" }],
      fri: [{ open: "09:00", close: "20:00" }],
      sat: [],
      sun: [],
    },
  };

  it("acepta un horario válido con los 7 días", () => {
    expect(openingHoursSchema.parse(valid)).toEqual(valid);
  });

  it("rechaza timezone IANA inválida", () => {
    expect(
      openingHoursSchema.safeParse({ ...valid, timezone: "Mars/Olympus" })
        .success,
    ).toBe(false);
  });

  it("rechaza rango con open >= close y hora malformada", () => {
    expect(
      openingHoursSchema.safeParse({
        ...valid,
        weekly: { ...valid.weekly, mon: [{ open: "20:00", close: "09:00" }] },
      }).success,
    ).toBe(false);
    expect(
      openingHoursSchema.safeParse({
        ...valid,
        weekly: { ...valid.weekly, mon: [{ open: "9:00", close: "25:00" }] },
      }).success,
    ).toBe(false);
  });

  it("rechaza si falta algún día de la semana", () => {
    const partial = { ...valid.weekly };
    delete (partial as Partial<typeof partial>).sun;
    expect(
      openingHoursSchema.safeParse({ ...valid, weekly: partial }).success,
    ).toBe(false);
  });
});

describe("createPlaceInputSchema", () => {
  const base = {
    name: "  Mi Comunidad  ",
    slug: "mi-comunidad",
    ownerTimezone: "America/Argentina/Buenos_Aires",
  };

  it("acepta el mínimo (name+slug+tz), trimea name, description→undefined", () => {
    const r = createPlaceInputSchema.parse(base);
    expect(r.name).toBe("Mi Comunidad");
    expect(r.slug).toBe("mi-comunidad");
    expect(r.description).toBeUndefined();
    expect(r.theme).toBeUndefined();
  });

  it("rechaza name vacío tras trim y excedido", () => {
    expect(createPlaceInputSchema.safeParse({ ...base, name: "   " }).success).toBe(
      false,
    );
    expect(
      createPlaceInputSchema.safeParse({ ...base, name: "x".repeat(81) }).success,
    ).toBe(false);
  });

  it("description en blanco se normaliza a undefined; excedida se rechaza", () => {
    expect(
      createPlaceInputSchema.parse({ ...base, description: "   " }).description,
    ).toBeUndefined();
    expect(
      createPlaceInputSchema.safeParse({ ...base, description: "x".repeat(501) })
        .success,
    ).toBe(false);
  });

  it("rechaza ownerTimezone inválida (input externo)", () => {
    expect(
      createPlaceInputSchema.safeParse({ ...base, ownerTimezone: "no/tz" })
        .success,
    ).toBe(false);
  });
});
