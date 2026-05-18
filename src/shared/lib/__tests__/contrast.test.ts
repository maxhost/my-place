import { describe, expect, it } from "vitest";
import {
  WCAG_AA_NORMAL,
  applyContrastGuardrail,
  contrastRatio,
  meetsAA,
} from "../contrast";

// Guardrail de contraste (ADR-0005 §8): puro, mismos umbrales que la landing
// (AA texto normal = 4.5:1). Deriva variante accesible + avisa qué ajustó;
// NUNCA bloquea, NUNCA persiste un par inaccesible silenciosamente.

describe("contrastRatio", () => {
  it("blanco vs negro = 21:1 (máximo)", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
  });

  it("es simétrico (orden de argumentos no importa)", () => {
    expect(contrastRatio("#c4632f", "#faf7f0")).toBeCloseTo(
      contrastRatio("#faf7f0", "#c4632f"),
      5,
    );
  });

  it("color contra sí mismo = 1:1", () => {
    expect(contrastRatio("#c4632f", "#c4632f")).toBeCloseTo(1, 5);
  });

  it("acepta hex de 3 dígitos y mayúsculas equivalente a 6 lowercase", () => {
    expect(contrastRatio("#FFF", "#000")).toBeCloseTo(
      contrastRatio("#ffffff", "#000000"),
      5,
    );
  });
});

describe("meetsAA", () => {
  it("ink papel sobre bg papel cumple AA", () => {
    expect(meetsAA("#1c1b22", "#faf7f0")).toBe(true);
  });

  it("accent crudo de marca sobre bg papel NO cumple AA (por eso existe accent-strong)", () => {
    expect(meetsAA("#c4632f", "#faf7f0")).toBe(false);
    expect(contrastRatio("#c4632f", "#faf7f0")).toBeLessThan(WCAG_AA_NORMAL);
  });
});

describe("applyContrastGuardrail", () => {
  it("paleta Papel: ink/bg ya cumple → ink no se ajusta", () => {
    const r = applyContrastGuardrail({
      accent: "#c4632f",
      bg: "#faf7f0",
      ink: "#1c1b22",
    });
    expect(r.palette.ink).toBe("#1c1b22");
    expect(r.palette.bg).toBe("#faf7f0");
    expect(r.adjustments.some((a) => a.token === "ink")).toBe(false);
  });

  it("deriva accentStrong que SÍ cumple AA sobre bg cuando el accent crudo no", () => {
    const r = applyContrastGuardrail({
      accent: "#c4632f",
      bg: "#faf7f0",
      ink: "#1c1b22",
    });
    expect(meetsAA(r.accentStrong, "#faf7f0")).toBe(true);
    expect(r.accentStrong).not.toBe("#c4632f");
    expect(r.adjustments.some((a) => a.token === "accentStrong")).toBe(true);
  });

  it("accent que ya cumple AA → accentStrong = accent, sin aviso", () => {
    const r = applyContrastGuardrail({
      accent: "#7a2e0e",
      bg: "#faf7f0",
      ink: "#1c1b22",
    });
    expect(meetsAA("#7a2e0e", "#faf7f0")).toBe(true);
    expect(r.accentStrong).toBe("#7a2e0e");
    expect(r.adjustments.some((a) => a.token === "accentStrong")).toBe(false);
  });

  it("ink ilegible sobre bg → ajusta ink hasta cumplir AA y lo reporta", () => {
    const r = applyContrastGuardrail({
      accent: "#c4632f",
      bg: "#faf7f0",
      ink: "#efe9dc", // casi igual al bg → ilegible
    });
    expect(meetsAA(r.palette.ink, "#faf7f0")).toBe(true);
    const adj = r.adjustments.find((a) => a.token === "ink");
    expect(adj).toBeDefined();
    expect(adj?.from).toBe("#efe9dc");
    expect(adj?.to).toBe(r.palette.ink);
  });

  it("bg oscuro + ink oscuro → ink se ajusta hacia claro (dirección correcta)", () => {
    const r = applyContrastGuardrail({
      accent: "#c4632f",
      bg: "#101014",
      ink: "#1c1b22",
    });
    expect(meetsAA(r.palette.ink, "#101014")).toBe(true);
  });

  it("nunca lanza ni bloquea aun con par patológico (bg gris medio)", () => {
    expect(() =>
      applyContrastGuardrail({
        accent: "#777777",
        bg: "#757575",
        ink: "#767676",
      }),
    ).not.toThrow();
    const r = applyContrastGuardrail({
      accent: "#777777",
      bg: "#757575",
      ink: "#767676",
    });
    expect(r.palette.bg).toBe("#757575"); // bg nunca se toca
    expect(typeof r.accentStrong).toBe("string");
  });

  it("normaliza la salida a #rrggbb lowercase", () => {
    const r = applyContrastGuardrail({
      accent: "#C4632F",
      bg: "#FAF7F0",
      ink: "#1C1B22",
    });
    expect(r.palette.accent).toBe("#c4632f");
    expect(r.palette.bg).toBe("#faf7f0");
    expect(r.palette.ink).toBe("#1c1b22");
  });
});
