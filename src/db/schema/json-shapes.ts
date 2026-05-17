// Shapes canónicos de las columnas JSONB (data-model.md § Shapes JSON, ADR-0005).
// El default en DB es '{}' / '[]' (placeholder); la saga (S4) escribe el shape
// canónico validado con Zod. Estos tipos describen el contenido poblado.

/** `place.theme_config` — paleta acotada (3 tokens; el resto se deriva en render). */
export type ThemeConfig = {
  colors: {
    accent: string; // acento de marca (CTA, kickers)
    bg: string; // fondo papel
    ink: string; // texto principal
  };
};

/** Rango horario local (hora del `timezone`); `[]` = cerrado ese día. */
export type OpeningRange = { open: string; close: string };

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** `place.opening_hours` — gate de horario (comportamiento: conversaciones.md). */
export type OpeningHours = {
  timezone: string; // IANA tz del owner
  weekly: Record<Weekday, OpeningRange[]>;
};

/** `place.enabled_features` — solo zonas OPCIONALES habilitadas. */
export type EnabledFeature = "events" | "library";
