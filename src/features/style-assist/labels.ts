// Contrato NARROW de labels i18n que consume `StyleAssistIsland` (ADR-0019).
// Vive en `style-assist` porque ES contrato de la asistencia LLM, no
// primitivo genérico (criterio ADR-0015 para `shared/`: comunes a múltiples
// slices). El bag completo del wizard (`WizardLabels` en place-wizard)
// extiende esta interfaz → cumple Liskov sin duplicar keys ni romper
// acíclico. `guardrailNotice` lo shareea estructuralmente con el `place-preview`
// del wizard (ambos lo consumen del mismo key — sin duplicación).

export interface StyleAssistLabels {
  /** Botón calmo "Sugerir un punto de partida" (idle). */
  assistButton: string;
  /** Texto del botón mientras la sugerencia está cargando. */
  assistLoading: string;
  /** Aviso muteado cuando aún no hay descripción para sugerir. */
  assistNeedDescription: string;
  /** Aviso calmo cuando el servicio LLM devuelve `unavailable`. */
  assistUnavailable: string;
  /** Título del bloque "Una propuesta para empezar". */
  assistProposedTitle: string;
  /** Hint debajo del título — tono cozytech, propose-only. */
  assistProposedHint: string;
  /** Encabezado de la sub-sección "Colores propuestos". */
  assistPaletteLabel: string;
  /** Encabezado de la sub-sección "Texto propuesto". */
  assistDescriptionLabel: string;
  /** Botón "Usar estos colores" (aplica la paleta propuesta — propose-only). */
  assistApplyPalette: string;
  /** Botón "Usar este texto" (aplica el borrador de descripción). */
  assistApplyDescription: string;
  /** Pill "Aplicado" tras aplicar paleta o texto. */
  assistApplied: string;
  /** Aviso calmo del guardrail de contraste cuando ajustó un color. */
  guardrailNotice: string;
}
