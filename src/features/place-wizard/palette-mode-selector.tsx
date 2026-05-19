import { useId, useState } from "react";
import { hexColorSchema, type Palette } from "@/shared/lib/palette-schema";
import { PALETTE_PRESETS } from "./palettes";
import type { WizardLabels } from "./wizard-labels";

// Selector del modo de paleta del Paso 2 (Estilo): "Predefinidas" (4 presets
// AA-limpios) vs "Personalizado" (3 hex que el owner edita). Cubre el
// principio "customización activa, no algorítmica" (`producto.md` §30).
// PRESENTACIONAL: el estado del modo/paleta vive en `usePlaceWizard`; acá
// sólo se rinden controles + un buffer LOCAL por canal para el text input
// (para mostrar el aviso calmo de hex inválido sin romper el último válido).
//
// Cozytech (`producto.md` §23-29): el aviso de hex inválido es calmo (texto
// muteado, sin parpadeo, sin alarma). Tailwind sólo layout/spacing; los
// colores del owner van inline (`style={{ background: hex }}`).

type Token = "accent" | "bg" | "ink";
type Buffers = Record<Token, string>;

const TOKENS: readonly Token[] = ["accent", "bg", "ink"];

function fromPalette(p: Palette | null): Buffers {
  if (!p) return { accent: "", bg: "", ink: "" };
  return { accent: p.accent, bg: p.bg, ink: p.ink };
}

const fieldClass =
  "min-h-[2.5rem] rounded-lg border border-border bg-surface px-3 text-base text-ink";

const modePill = (active: boolean) =>
  `min-h-[2.5rem] flex-1 rounded-lg border px-4 text-sm cursor-pointer text-center leading-[2.5rem] ${
    active ? "border-accent-strong text-ink" : "border-border text-muted"
  }`;

export function PaletteModeSelector(p: {
  labels: WizardLabels;
  mode: "preset" | "custom";
  presetIds: readonly string[];
  selectedPresetId: string;
  /** En modo "custom" se garantiza no-null (el hook copia el preset al
   *  cambiar de modo). En modo "preset" puede ser null. */
  customPalette: Palette | null;
  onModeChange: (mode: "preset" | "custom") => void;
  onPresetChange: (id: string) => void;
  onCustomHexChange: (token: Token, value: string) => void;
}) {
  const { labels: l, customPalette } = p;
  const ids = {
    accent: useId(),
    bg: useId(),
    ink: useId(),
  };
  // Buffer local para los TEXT inputs (la fuente de verdad de la paleta es
  // `customPalette` del hook). Permite aceptar input transitorio inválido
  // sin pisar el último válido — el hook sólo se actualiza cuando parsea.
  const [buffers, setBuffers] = useState<Buffers>(() => fromPalette(customPalette));

  // Sincroniza buffers cuando `customPalette` cambia EXTERNAMENTE (LLM apply,
  // switch de modo). Patrón "derived state on prop change" recomendado en
  // React docs (setState durante render con guarda — React batchea y bailout
  // si no hay diff). Por canal: si el `customPalette` recibido NO matchea lo
  // que ya tenemos parseado, reset; si matchea, es eco de nuestro propio
  // input — no piso el buffer mid-typing (bug real expuesto por test).
  const [prevCustomPalette, setPrevCustomPalette] = useState(customPalette);
  if (customPalette !== prevCustomPalette) {
    setPrevCustomPalette(customPalette);
    setBuffers((prev) => {
      const next = { ...prev };
      for (const t of TOKENS) {
        const incoming = customPalette ? customPalette[t] : "";
        const parsedPrev = hexColorSchema.safeParse(prev[t]);
        if (!parsedPrev.success || parsedPrev.data !== incoming) {
          next[t] = incoming;
        }
      }
      return next;
    });
  }

  function onText(token: Token, value: string) {
    setBuffers((b) => ({ ...b, [token]: value }));
    const parsed = hexColorSchema.safeParse(value);
    if (parsed.success) p.onCustomHexChange(token, parsed.data);
  }

  function onPicker(token: Token, value: string) {
    setBuffers((b) => ({ ...b, [token]: value }));
    p.onCustomHexChange(token, value);
  }

  const channelLabel: Record<Token, string> = {
    accent: l.paletteCustomAccentLabel,
    bg: l.paletteCustomBgLabel,
    ink: l.paletteCustomInkLabel,
  };

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-medium text-ink">{l.paletteLabel}</legend>

      <div className="flex flex-col gap-2">
        <span className="text-sm text-muted">{l.paletteModeLabel}</span>
        <div role="radiogroup" aria-label={l.paletteModeLabel} className="flex gap-2">
          {(["preset", "custom"] as const).map((m) => (
            <label key={m} className={modePill(p.mode === m)}>
              <input
                type="radio"
                name="paletteMode"
                className="sr-only"
                checked={p.mode === m}
                onChange={() => p.onModeChange(m)}
              />
              {m === "preset" ? l.paletteModePreset : l.paletteModeCustom}
            </label>
          ))}
        </div>
      </div>

      {p.mode === "preset" && (
        <div className="flex flex-wrap gap-3">
          {PALETTE_PRESETS.map((preset) => {
            const id = `palette-${preset.id}`;
            return (
              <span key={preset.id} className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  id={id}
                  name="palette"
                  checked={p.selectedPresetId === preset.id}
                  onChange={() => p.onPresetChange(preset.id)}
                />
                <label
                  htmlFor={id}
                  className="inline-flex items-center gap-2 text-sm text-ink"
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-4 w-4 rounded-full border border-border"
                    style={{ background: preset.palette.accent }}
                  />
                  {l.paletteNames[preset.id] ?? preset.id}
                </label>
              </span>
            );
          })}
        </div>
      )}

      {p.mode === "custom" && customPalette && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-ink">{l.paletteCustomTitle}</p>
          {TOKENS.map((token) => {
            const buf = buffers[token];
            const parsed = hexColorSchema.safeParse(buf);
            const invalid = buf.length > 0 && !parsed.success;
            return (
              <div key={token} className="flex items-start gap-3">
                <input
                  type="color"
                  aria-label={`${channelLabel[token]} ${l.paletteCustomPickerSuffix}`}
                  value={parsed.success ? parsed.data : customPalette[token]}
                  onChange={(e) => onPicker(token, e.target.value)}
                  className="h-10 w-10 rounded-lg border border-border bg-surface p-0"
                />
                <div className="flex flex-1 flex-col gap-1">
                  <label htmlFor={ids[token]} className="text-sm text-ink">
                    {channelLabel[token]}
                  </label>
                  <input
                    id={ids[token]}
                    type="text"
                    value={buf}
                    placeholder="#rrggbb"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => onText(token, e.target.value)}
                    className={fieldClass}
                  />
                  {invalid && (
                    <p className="text-sm text-muted">
                      {l.paletteCustomHexInvalid}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
