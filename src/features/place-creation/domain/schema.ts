import { z } from "zod";
import { isReservedSlug } from "@/shared/config/reserved-slugs";
import { routing } from "@/i18n/routing";
import {
  hexColorSchema,
  type Palette,
  paletteSchema,
} from "@/shared/lib/palette-schema";
import type {
  OpeningHours,
  ThemeConfig,
  Weekday,
} from "@/db/schema/json-shapes";

// Zod del payload de creación de place (CLAUDE.md: Zod para TODO input
// externo). PURO: sin red ni DB. La unicidad de slug NO se valida acá — esa
// frontera dura es el `UNIQUE` de la DB (S1) vía la saga (S5b). Acá: formato
// de subdominio + reservados (UX/app, lista estática) + shapes canónicos de
// `data-model.md` / `json-shapes.ts`.

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export { WEEKDAYS };

// Label DNS: 1–63, minúsc. alfanum + guion interno, sin guion de borde.
// Mínimo de producto 3 (los de 1–2 chars son infra-riesgo, mismo criterio
// que `reserved-slugs`); el límite duro de unicidad es el `UNIQUE` de S1.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const slugSchema = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(
    z
      .string()
      .min(3, "El slug debe tener al menos 3 caracteres")
      .max(63, "El slug no puede exceder 63 caracteres")
      .regex(
        SLUG_RE,
        "Solo minúsculas, números y guiones; sin guion al inicio/fin",
      )
      .refine((s) => !isReservedSlug(s), "Ese slug está reservado"),
  );

// Primitivo de paleta hex extraído a `shared/` (ADR-0015): compartido con
// `style-assist` sin arista feature→feature. Se re-exporta para los
// consumidores internos/tests existentes (sin cambio de comportamiento).
export { hexColorSchema, paletteSchema };

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z
  .string()
  .trim()
  .refine(isValidTimezone, "Zona horaria IANA inválida");

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const openingRangeSchema = z
  .object({
    open: z.string().regex(HHMM, "Hora inválida (HH:MM 24h)"),
    close: z.string().regex(HHMM, "Hora inválida (HH:MM 24h)"),
  })
  .refine((r) => r.open < r.close, "El cierre debe ser posterior a la apertura");

const dayRangesSchema = z.array(openingRangeSchema);

export const openingHoursSchema: z.ZodType<OpeningHours> = z.object({
  timezone: timezoneSchema,
  weekly: z.object(
    Object.fromEntries(WEEKDAYS.map((d) => [d, dayRangesSchema])) as Record<
      Weekday,
      typeof dayRangesSchema
    >,
  ),
});

export const createPlaceInputSchema = z.object({
  name: z
    .string()
    .transform((s) => s.trim())
    .pipe(
      z
        .string()
        .min(1, "El nombre es obligatorio")
        .max(80, "El nombre no puede exceder 80 caracteres"),
    ),
  slug: slugSchema,
  description: z
    .string()
    .max(500, "La descripción no puede exceder 500 caracteres")
    .transform((s) => s.trim())
    .transform((s) => (s.length === 0 ? undefined : s))
    .optional(),
  theme: paletteSchema.optional(),
  ownerTimezone: timezoneSchema,
  openingHours: openingHoursSchema.optional(),
  // ADR-0022 (place.default_locale editable por owner) + ADR-0024 (6 locales
  // operativos día uno). Source of truth de la lista: `routing.locales` —
  // mismo set que la cookie i18n y el path `/[locale]`. La DB tiene CHECK
  // constraint con la misma lista (migration 0006) como defense-in-depth.
  // Default 'es' (ADR-0024 + `routing.defaultLocale`): si el wizard no toca
  // el campo (Paso 1 vacío), el place nace 'es' como hoy.
  defaultLocale: z.enum(routing.locales).default(routing.defaultLocale),
});

// INPUT del wire (pre-parse). El Server Action recibe esto desde el wizard
// y lo parsea internamente con `buildPlaceCreation` → defaults aplicados +
// transforms (lowercase slug, trim name, etc.). Hasta S2a.1 el schema no tenía
// `.default()` activos así que `z.infer` (= output) y `z.input` eran iguales
// modulo transforms inmutables-de-tipo; con `defaultLocale: z.enum(...).default('es')`
// la asimetría se vuelve real — el campo es opcional al INPUT pero garantizado
// al OUTPUT. Tipar el contrato cliente↔servidor como INPUT permite que el
// wizard omita defaultLocale hasta que S2b agregue el selector del Paso 1.
export type CreatePlaceInput = z.input<typeof createPlaceInputSchema>;
export type { Palette };
export type { ThemeConfig };
