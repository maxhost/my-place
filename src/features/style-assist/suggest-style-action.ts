"use server";

import { generateObject } from "ai";
import { z } from "zod";
import { getCurrentUserIdentityForRequest } from "@/shared/lib/current-user-identity";
import { type StyleSuggestionResult, suggestStyle } from "./suggest-style";

// Wiring VIVO del Vercel AI Gateway (S10a, ADR-0005 §5 / ADR-0007). Seam-split
// como `actions.ts`/`create-place.ts`: su correctitud es de tipo/build +
// preview Vercel, NO vitest (arrastra `ai` + red). La lógica (validación Zod +
// guardrail + degradación elegante) está testeada en `suggest-style.test.ts`
// con el puerto inyectado. NUNCA persiste: propose-only (el owner confirma
// cada parte en S10b, ADR-0005 §6).
//
// ## Auth gate (Phase 0.A tech-debt closure, 2026-05-28)
//
// El endpoint LLM debe estar gated por sesión para evitar cost-amplification
// por visitor anónimo invocando el AI Gateway sin pagar el costo de signup.
// Identidad mínima vía integrator zone-aware (ADR-0046 §D.fix.3) — el wizard
// que consume esta action vive en `/crear` apex, así que el visitor SIEMPRE
// tiene sesión Neon Auth si llegó al paso de style-assist. Si no la tiene
// (e.g. cookie expirada mid-wizard, o caller no-canónico), degrada a
// `unavailable` per contrato del slice — la asistencia LLM es opcional, su
// caída jamás rompe el wizard (ADR-0005 §5).

// Modelo: punto ÚNICO de cambio. String `"provider/model"` plano → Vercel AI
// Gateway (default Vercel; `AI_GATEWAY_API_KEY` en env, no se ata a un paquete
// de proveedor — cambiar de proveedor NO requiere key nueva). Haiku 4.5:
// chico/rápido con structured output sólido, de sobra para proponer 3 hex +
// 1–2 frases (el dominio re-valida con Zod + guardrail igual). ADR-0005
// mandaba fijar el modelo concreto al implementar (TBD cerrado). El slug
// exacto del Gateway se verifica en preview Vercel (seam-split): si fuera
// inválido, la saga degrada a `unavailable` sin romper el wizard.
const LLM_MODEL = "anthropic/claude-haiku-4-5";

// Timeout del call al Gateway (S2 hardening post-review 2026-06-11). Sin
// signal, un Gateway colgado retiene la action hasta el timeout de la
// función (300s) con el owner mirando spinner. 15s sobra para ~60 tokens de
// output de Haiku; el abort lanza dentro del puerto y `suggestStyle` lo
// colapsa a `unavailable` (degradación elegante, ADR-0005 §5).
const LLM_TIMEOUT_MS = 15_000;

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
  // Auth gate: visitor anónimo → `unavailable` (anti-cost-amplification LLM).
  // Ver JSDoc §"Auth gate" arriba.
  const identity = await getCurrentUserIdentityForRequest();
  if (identity === null) return { status: "unavailable" };

  return suggestStyle(description, {
    suggest: async (text) => {
      const { object } = await generateObject({
        model: LLM_MODEL,
        schema: generationShape,
        system: SYSTEM,
        prompt: `Para quién es el espacio: ${text}`,
        abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });
      return object;
    },
  });
}
