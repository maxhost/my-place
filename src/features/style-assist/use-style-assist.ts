"use client";

import { useRef, useState } from "react";
import type { Palette } from "@/shared/lib/palette-schema";
import type { StyleSuggestion } from "./domain/style-suggestion";
import type { suggestStyleAction } from "./suggest-style-action";

// Máquina de la isla LLM propose-only (ADR-0005 §5-§6). Vive en `style-assist`
// (ADR-0019, dueño del concern LLM: saga + Server Action + UI glue). El
// consumer (wizard) la importa vía `./public`. Recibe la descripción para
// gating + setters externos para aplicar la propuesta (paleta y texto).
// NUNCA auto-aplica; falla → `unavailable` (no rompe el wizard).
// `resetPaletteApplied` lo consume el orquestador del wizard para el cruce
// LLM↔preset.

// Tipo del Server Action local (evita import circular pasando por `./public`,
// que re-exporta este hook).
type SuggestStyle = typeof suggestStyleAction;
type SuggestPhase = "idle" | "loading" | "ready" | "unavailable";

export function useStyleAssist(opts: {
  onSuggest?: SuggestStyle;
  description: string;
  setCustomPalette: (p: Palette) => void;
  setDescription: (d: string) => void;
}) {
  const [suggestPhase, setSuggestPhase] = useState<SuggestPhase>("idle");
  const [suggestion, setSuggestion] = useState<StyleSuggestion | null>(null);
  const [paletteApplied, setPaletteApplied] = useState(false);
  const [descriptionApplied, setDescriptionApplied] = useState(false);
  const suggestingRef = useRef(false);

  const suggestEnabled = !!opts.onSuggest;
  const suggestReady = opts.description.trim().length > 0;
  const canSuggest = suggestEnabled && suggestPhase !== "loading";

  async function handleSuggest() {
    if (!opts.onSuggest || suggestingRef.current || !suggestReady) return;
    suggestingRef.current = true;
    setSuggestPhase("loading");
    try {
      const res = await opts.onSuggest(opts.description.trim());
      if (res.status === "suggested") {
        setSuggestion({
          palette: res.palette,
          accentStrong: res.accentStrong,
          adjustments: res.adjustments,
          descriptionDraft: res.descriptionDraft,
        });
        setSuggestPhase("ready");
        setPaletteApplied(false);
        setDescriptionApplied(false);
      } else {
        setSuggestion(null);
        setSuggestPhase("unavailable");
      }
    } catch {
      setSuggestion(null);
      setSuggestPhase("unavailable");
    } finally {
      suggestingRef.current = false;
    }
  }

  function applySuggestedPalette() {
    if (!suggestion) return;
    opts.setCustomPalette(suggestion.palette);
    setPaletteApplied(true);
  }
  function applySuggestedDescription() {
    if (!suggestion) return;
    opts.setDescription(suggestion.descriptionDraft);
    setDescriptionApplied(true);
  }
  function resetPaletteApplied() {
    setPaletteApplied(false);
  }

  return {
    suggestPhase,
    suggestion,
    paletteApplied,
    descriptionApplied,
    suggestEnabled,
    canSuggest,
    suggestReady,
    handleSuggest,
    applySuggestedPalette,
    applySuggestedDescription,
    resetPaletteApplied,
  };
}
