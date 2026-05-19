import { useRef, useState } from "react";
import type { StyleSuggestion } from "@/features/style-assist/public";
import type { Palette } from "@/shared/lib/palette-schema";
import type { WizardSuggest } from "./wizard-labels";

// Sub-hook 4/6: máquina de la isla LLM propose-only (ADR-0005 §5-§6).
// Recibe description (gating) + setters de use-style-step (aplicar propuesta).
// NUNCA auto-aplica; falla → unavailable (no rompe wizard). `resetPaletteApplied`
// lo consume el orquestador para el cruce. Ver mapa en `use-place-wizard.ts`.

type SuggestPhase = "idle" | "loading" | "ready" | "unavailable";

export function useStyleAssist(opts: {
  onSuggest?: WizardSuggest;
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
