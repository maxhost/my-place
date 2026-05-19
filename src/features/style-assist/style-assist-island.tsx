"use client";

import type { StyleSuggestion } from "./domain/style-suggestion";
import type { StyleAssistLabels } from "./labels";

// Isla de asistencia LLM propose-only del Paso 2 (ADR-0005 §5/§6 / ADR-0007).
// Vive en `style-assist` (ADR-0019, dueño del concern LLM). PRESENTACIONAL:
// sin estado ni red — la máquina vive en `useStyleAssist`, el Server Action
// vivo se inyecta en la ruta (seam-split). El consumer (wizard) importa la
// isla vía `./public` y le pasa un `labels` que satisface `StyleAssistLabels`
// (su `WizardLabels` extiende este contrato narrow). `producto.md` cozytech:
// el botón NO es la CTA (no grita), los avisos son calmos y NO bloquean, y
// NADA se auto-aplica — el owner aplica cada parte. Tailwind sólo layout/
// spacing; chrome con tokens del producto; los colores PROPUESTOS del place
// van inline (como el preview), nunca clases Tailwind.

const quietBtn =
  "inline-flex min-h-[2.25rem] items-center rounded-lg border border-border px-3 text-sm text-ink disabled:opacity-40";

export function StyleAssistIsland(p: {
  labels: StyleAssistLabels;
  phase: "idle" | "loading" | "ready" | "unavailable";
  suggestReady: boolean;
  canSuggest: boolean;
  suggestion: StyleSuggestion | null;
  paletteApplied: boolean;
  descriptionApplied: boolean;
  onSuggest: () => void;
  onApplyPalette: () => void;
  onApplyDescription: () => void;
}) {
  const { labels: l, suggestion: s } = p;
  return (
    <section
      aria-label={l.assistButton}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-4"
    >
      <button
        type="button"
        disabled={!p.canSuggest || !p.suggestReady}
        onClick={p.onSuggest}
        className={`self-start ${quietBtn} min-h-[2.5rem] px-4`}
      >
        {p.phase === "loading" ? l.assistLoading : l.assistButton}
      </button>

      {!p.suggestReady && (
        <p className="text-sm text-muted">{l.assistNeedDescription}</p>
      )}

      {p.phase === "unavailable" && (
        <p
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
          aria-live="polite"
        >
          {l.assistUnavailable}
        </p>
      )}

      {p.phase === "ready" && s && (
        <div className="flex flex-col gap-4" aria-live="polite">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-ink">
              {l.assistProposedTitle}
            </p>
            <p className="text-sm text-muted">{l.assistProposedHint}</p>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink">{l.assistPaletteLabel}</p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex gap-1" aria-hidden="true">
                {[s.palette.bg, s.palette.accent, s.palette.ink].map((c) => (
                  <span
                    key={c}
                    className="inline-block h-5 w-5 rounded-full border border-border"
                    style={{ background: c }}
                  />
                ))}
              </span>
              <button
                type="button"
                onClick={p.onApplyPalette}
                className={quietBtn}
              >
                {l.assistApplyPalette}
              </button>
              {p.paletteApplied && (
                <span className="text-sm text-muted">{l.assistApplied}</span>
              )}
            </div>
            {s.adjustments.length > 0 && (
              <p className="text-sm text-muted">{l.guardrailNotice}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink">{l.assistDescriptionLabel}</p>
            <p className="rounded-lg border border-border px-3 py-2 text-sm text-ink">
              {s.descriptionDraft}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={p.onApplyDescription}
                className={`self-start ${quietBtn}`}
              >
                {l.assistApplyDescription}
              </button>
              {p.descriptionApplied && (
                <span className="text-sm text-muted">{l.assistApplied}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
