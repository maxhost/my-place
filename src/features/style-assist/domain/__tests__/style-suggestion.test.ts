import { describe, expect, it } from "vitest";
import {
  StyleSuggestionError,
  parseStyleSuggestion,
} from "../style-suggestion";

// S10a: el dominio re-valida la salida CRUDA del modelo (nunca se confía en
// el LLM) y aplica el guardrail de contraste a la paleta propuesta (S5a), de
// modo que lo ofrecido al owner ya es accesible (ADR-0005 §8). Sin horario
// (ADR-0007). PURO: sin red. Nada se persiste (propose-only).

const AA_CLEAN = {
  palette: { accent: "#1b5e20", bg: "#ffffff", ink: "#111111" },
  descriptionDraft: "Un espacio tranquilo para vecinos que comparten huerta.",
};

describe("parseStyleSuggestion — salida del LLM (ADR-0005 §5 / ADR-0007)", () => {
  it("valida la salida cruda y normaliza el hex (3→6 dígitos, trim del borrador)", () => {
    const s = parseStyleSuggestion({
      palette: { accent: "#abc", bg: "#FFF", ink: "#123456" },
      descriptionDraft: "  Café de barrio para juntarse a leer.  ",
    });
    expect(s.palette).toEqual({
      accent: "#aabbcc",
      bg: "#ffffff",
      ink: "#123456",
    });
    expect(s.descriptionDraft).toBe("Café de barrio para juntarse a leer.");
  });

  it("aplica el guardrail: par de bajo contraste → ajusta ink y reporta", () => {
    const s = parseStyleSuggestion({
      palette: { accent: "#777777", bg: "#ffffff", ink: "#cccccc" },
      descriptionDraft: "Para quienes buscan calma.",
    });
    const inkAdj = s.adjustments.find((a) => a.token === "ink");
    expect(inkAdj).toBeDefined();
    // El ink propuesto NO se ofrece tal cual: se devuelve la variante AA.
    expect(s.palette.ink).not.toBe("#cccccc");
    expect(typeof s.accentStrong).toBe("string");
  });

  it("paleta AA-limpia → sin ajuste de ink (no se inventa ruido)", () => {
    const s = parseStyleSuggestion(AA_CLEAN);
    expect(s.adjustments.some((a) => a.token === "ink")).toBe(false);
    expect(s.palette.ink).toBe("#111111");
  });

  it.each([
    ["sin palette", { descriptionDraft: "hola" }],
    ["hex inválido", { palette: { accent: "rojo", bg: "#fff", ink: "#000" }, descriptionDraft: "x" }],
    ["borrador vacío", { palette: AA_CLEAN.palette, descriptionDraft: "   " }],
    ["borrador >500", { palette: AA_CLEAN.palette, descriptionDraft: "a".repeat(501) }],
    ["no es objeto", "texto suelto"],
    ["null", null],
  ])("malformado (%s) → StyleSuggestionError, nunca filtra ZodError", (_, raw) => {
    expect(() => parseStyleSuggestion(raw)).toThrow(StyleSuggestionError);
  });
});
