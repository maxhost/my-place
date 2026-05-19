import type { OpeningHours } from "@/db/schema/json-shapes";
import { WEEKDAYS } from "./schema";

// Defaults de dominio (ADR-0005 §7 / ADR-0007, shapes en `json-shapes.ts`).

/**
 * Paleta "Papel" de marca = mismos valores que la landing (continuidad
 * visual marca↔place, ADR-0005 §7). Default cuando el owner no elige.
 */
export const PAPEL_PALETTE = {
  accent: "#c4632f",
  bg: "#faf7f0",
  ink: "#1c1b22",
} as const;

/**
 * Horario default al crear el place (ADR-0007): 09:00–20:00 todos los días
 * en la timezone del owner. El LLM NO propone horario; el owner lo edita
 * luego en `/settings`.
 */
export function defaultOpeningHours(timezone: string): OpeningHours {
  return {
    timezone,
    weekly: Object.fromEntries(
      WEEKDAYS.map((d) => [d, [{ open: "09:00", close: "20:00" }]]),
    ) as OpeningHours["weekly"],
  };
}
