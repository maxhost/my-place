import { z } from "zod";

// Schema Zod del primitivo de paleta hex (ADR-0015). Extraído a `shared/`
// para que `place-creation` y `style-assist` lo compartan SIN arista
// feature→feature (architecture.md §25: lo común entre slices va a
// `shared/`, no se duplica ni se importa de otra feature). PURO: sin red.
// `Palette` es estructuralmente `@/shared/lib/contrast`.Palette.

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Color hex inválido")
  .transform((h) => {
    const body = h.slice(1).toLowerCase();
    const full =
      body.length === 3
        ? body
            .split("")
            .map((c) => c + c)
            .join("")
        : body;
    return `#${full}`;
  });

export const paletteSchema = z.object({
  accent: hexColorSchema,
  bg: hexColorSchema,
  ink: hexColorSchema,
});

export type Palette = z.infer<typeof paletteSchema>;
