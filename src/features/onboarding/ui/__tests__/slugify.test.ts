import { describe, expect, it } from "vitest";
import { slugify } from "../slugify";

// `slugify` deriva una SUGERENCIA de slug desde el nombre libre (afordancia
// de UI, NO autoritativa — la validación dura es `slugSchema`/`UNIQUE`).
// Puro, sin red ni DOM → proyecto `node`.
describe("slugify", () => {
  it("baja a minúsculas y reemplaza espacios por guiones", () => {
    expect(slugify("Mi Club De Lectura")).toBe("mi-club-de-lectura");
  });

  it("quita diacríticos (NFKD) manteniendo la letra base", () => {
    expect(slugify("Café Münchön ñandú")).toBe("cafe-munchon-nandu");
  });

  it("colapsa separadores múltiples y recorta guiones de borde", () => {
    expect(slugify("  --Hola__mundo!!  ")).toBe("hola-mundo");
  });

  it("descarta símbolos no alfanuméricos", () => {
    expect(slugify("C++ & Diseño @ 2026")).toBe("c-diseno-2026");
  });

  it("recorta a 63 chars sin dejar guion final", () => {
    const out = slugify("a".repeat(60) + " " + "b".repeat(10));
    expect(out.length).toBeLessThanOrEqual(63);
    expect(out.endsWith("-")).toBe(false);
  });

  it("devuelve cadena vacía si no queda nada utilizable", () => {
    expect(slugify("   !!!  ")).toBe("");
    expect(slugify("")).toBe("");
  });
});
