"use server";

import { generateObject } from "ai";
import { z } from "zod";
import { type StyleSuggestionResult, suggestStyle } from "./suggest-style";

// Wiring VIVO del Vercel AI Gateway (S10a, ADR-0005 §5 / ADR-0007). Seam-split
// como `actions.ts`/`create-place.ts`: su correctitud es de tipo/build +
// preview Vercel, NO vitest (arrastra `ai` + red). La lógica (validación Zod +
// guardrail + degradación elegante) está testeada en `suggest-style.test.ts`
// con el puerto inyectado. NUNCA persiste: propose-only (el owner confirma
// cada parte en S10b, ADR-0005 §6).

// Modelo: punto ÚNICO de cambio. String `"provider/model"` plano → Vercel AI
// Gateway (default Vercel; `AI_GATEWAY_API_KEY` en env, no se ata a un paquete
// de proveedor). Chico/rápido con structured output sólido; ADR-0005 mandaba
// fijar el modelo concreto al implementar (TBD cerrado acá).
const LLM_MODEL = "openai/gpt-4o-mini";

// Forma de generación PLANA (sin transforms): JSON-schema limpio para el
// structured output. El dominio (`parseStyleSuggestion`) re-valida estricto y
// aplica el guardrail — defensa en profundidad, nunca se confía en el modelo.
const generationShape = z.object({
  palette: z.object({
    accent: z.string().describe("Color de acento, hex #rrggbb"),
    bg: z.string().describe("Color de fondo (lienzo claro), hex #rrggbb"),
    ink: z.string().describe("Color de texto principal, hex #rrggbb"),
  }),
  descriptionDraft: z
    .string()
    .describe("Borrador cálido del lugar: 1–2 frases, máx 500 caracteres"),
});

const SYSTEM = [
  "Sos un asistente de diseño para comunidades pequeñas y cálidas.",
  "A partir de la descripción de PARA QUIÉN es el espacio, proponés UNA",
  "paleta accesible y un borrador breve de la descripción del lugar.",
  "Respondé SIEMPRE en el mismo idioma de la descripción recibida.",
  "Colores en hex #rrggbb sobre un lienzo claro. El borrador: 1–2 frases,",
  "máx 500 caracteres, tono cálido y sin signos de exclamación.",
  "NO propongas horarios ni datos operativos.",
].join(" ");

export async function suggestStyleAction(
  description: string,
): Promise<StyleSuggestionResult> {
  return suggestStyle(description, {
    suggest: async (text) => {
      const { object } = await generateObject({
        model: LLM_MODEL,
        schema: generationShape,
        system: SYSTEM,
        prompt: `Para quién es el espacio: ${text}`,
      });
      return object;
    },
  });
}
