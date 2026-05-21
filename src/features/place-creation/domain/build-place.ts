import { z } from "zod";
import type { OpeningHours, ThemeConfig } from "@/db/schema/json-shapes";
import {
  type ContrastAdjustment,
  applyContrastGuardrail,
} from "@/shared/lib/contrast";
import { PAPEL_PALETTE, defaultOpeningHours } from "./defaults";
import { createPlaceInputSchema } from "./schema";

// Ensamblado puro del dominio de creación (S5a). NO toca DB ni SDK: valida
// (Zod) → aplica defaults → corre el guardrail de contraste → produce los
// args canónicos de `app.create_place` (S3). La saga (S5b) sólo orquesta
// identidad y ejecuta la función con esto. Determinista y unit-testeable.

export type OnboardingErrorCode = "INVALID_PAYLOAD";

/** Error de dominio mapeado (nunca se filtra un `ZodError` crudo afuera). */
export class OnboardingDomainError extends Error {
  readonly code: OnboardingErrorCode;
  /** Campos del payload que fallaron (para foco en UI). */
  readonly fields: string[];

  constructor(code: OnboardingErrorCode, message: string, fields: string[]) {
    super(message);
    this.name = "OnboardingDomainError";
    this.code = code;
    this.fields = fields;
  }

  toUserMessage(): string {
    return this.message;
  }
}

function mapZodError(err: z.ZodError): OnboardingDomainError {
  const fields = [
    ...new Set(err.issues.map((i) => String(i.path[0] ?? "payload"))),
  ];
  const message = err.issues
    .map((i) => `${i.path.join(".") || "payload"}: ${i.message}`)
    .join("; ");
  return new OnboardingDomainError("INVALID_PAYLOAD", message, fields);
}

export type PlaceCreationArgs = {
  slug: string;
  name: string;
  description: string | null;
  themeConfig: ThemeConfig;
  openingHours: OpeningHours;
  /** Locale del chrome del place (ADR-0022 + ADR-0024). Validado por zod
   *  contra `routing.locales`; el caller lo pasa como 6º arg de
   *  `app.create_place` (overload de migration 0007). */
  defaultLocale: string;
  /** Avisos del guardrail para mostrarle al owner (ADR-0005 §8). */
  adjustments: ContrastAdjustment[];
};

/**
 * Valida + normaliza el payload de creación y produce los args canónicos de
 * `app.create_place`. Lanza `OnboardingDomainError` ante payload inválido;
 * el guardrail de contraste NUNCA bloquea (ajusta y avisa, ADR-0005 §8).
 */
export function buildPlaceCreation(raw: unknown): PlaceCreationArgs {
  const parsed = createPlaceInputSchema.safeParse(raw);
  if (!parsed.success) throw mapZodError(parsed.error);
  const input = parsed.data;

  const { palette, adjustments } = applyContrastGuardrail(
    input.theme ?? PAPEL_PALETTE,
  );

  return {
    slug: input.slug,
    name: input.name,
    description: input.description ?? null,
    // Se persisten SOLO los 3 tokens del owner (ADR-0005 §7); `ink` puede
    // venir ajustado por el guardrail. Los derivados (accentStrong, etc.) se
    // calculan en render, no se persisten.
    themeConfig: { colors: palette },
    openingHours: input.openingHours ?? defaultOpeningHours(input.ownerTimezone),
    // Zod ya aplicó default 'es' si el wizard no setea el campo (ADR-0024).
    defaultLocale: input.defaultLocale,
    adjustments,
  };
}
