// Puerto cross-system del slice `style-assist` (ADR-0015, extraído de
// `place-creation/ports.ts`).

/**
 * Puerto LLM del servicio de sugerencia de estilo (S10a, ADR-0005 §5 /
 * ADR-0007): a partir de la descripción libre "para quién es el place"
 * devuelve el OBJETO CRUDO del modelo (sin validar) — el dominio lo re-valida
 * con Zod y aplica el guardrail (defensa en profundidad: nunca se confía en
 * el LLM). Mismo seam-split que S5b: el wiring vivo del Vercel AI Gateway se
 * verifica por tipo/build + preview, NO en vitest (arrastra `ai` + red).
 */
export type StyleSuggester = (description: string) => Promise<unknown>;
