import { describe, expect, it, vi } from "vitest";
import { suggestStyle } from "../suggest-style";

// S10a: la SAGA del servicio LLM es orquestación PURA. El borde con el modelo
// (Vercel AI Gateway) se inyecta como PUERTO (mismo seam-split que S5b: el
// wiring vivo se verifica en preview, no en vitest). El modo de fallo es
// SIEMPRE `unavailable` (degradación elegante, ADR-0005 §5): la asistencia es
// opcional, su caída jamás rompe el wizard ni lanza al caller.

const OK = {
  palette: { accent: "#2f6d4f", bg: "#f4f6f1", ink: "#1b211c" },
  descriptionDraft: "Un lugar para vecinos que cultivan huerta comunitaria.",
};

describe("suggestStyle — saga del servicio LLM (ADR-0005 §5 / ADR-0007)", () => {
  it("happy path: puerto → dominio → propuesta accesible (propose-only)", async () => {
    const suggest = vi.fn(async () => OK);
    const res = await suggestStyle("  para vecinos con huerta  ", { suggest });

    expect(res.status).toBe("suggested");
    if (res.status !== "suggested") throw new Error("unreachable");
    expect(res.palette.bg).toBe("#f4f6f1");
    expect(res.descriptionDraft).toBe(OK.descriptionDraft);
    expect(Array.isArray(res.adjustments)).toBe(true);
    expect(suggest).toHaveBeenCalledWith("para vecinos con huerta"); // trim
  });

  it("aplica el guardrail vía la saga (paleta de bajo contraste → ajuste ink)", async () => {
    const res = await suggestStyle("para gente que busca calma", {
      suggest: async () => ({
        palette: { accent: "#777777", bg: "#ffffff", ink: "#cccccc" },
        descriptionDraft: "Espacio sereno de barrio.",
      }),
    });
    expect(res.status).toBe("suggested");
    if (res.status !== "suggested") throw new Error("unreachable");
    expect(res.adjustments.some((a) => a.token === "ink")).toBe(true);
    expect(res.palette.ink).not.toBe("#cccccc");
  });

  it.each([["", ""], ["whitespace", "   \n  "], ["no-string", 42 as unknown]])(
    "descripción vacía/%s → unavailable SIN gastar llamada al modelo",
    async (_label, desc) => {
      const suggest = vi.fn();
      const res = await suggestStyle(desc, { suggest });
      expect(res.status).toBe("unavailable");
      expect(suggest).not.toHaveBeenCalled();
    },
  );

  it("el modelo lanza (red/timeout/cuota) → unavailable, NO propaga", async () => {
    const res = await suggestStyle("para una banda de música", {
      suggest: async () => {
        throw new Error("gateway 503");
      },
    });
    expect(res.status).toBe("unavailable");
  });

  it("el modelo devuelve malformado → unavailable (parser Zod rechaza)", async () => {
    const res = await suggestStyle("para un club de lectura", {
      suggest: async () => ({ palette: { accent: "rojo" }, foo: 1 }),
    });
    expect(res.status).toBe("unavailable");
  });

  it("acota el prompt: la descripción se trunca antes de ir al modelo", async () => {
    const suggest = vi.fn<(text: string) => Promise<typeof OK>>(
      async () => OK,
    );
    await suggestStyle("x".repeat(5000), { suggest });
    const sent = suggest.mock.calls[0][0];
    expect(sent.length).toBeLessThanOrEqual(2000);
  });
});
