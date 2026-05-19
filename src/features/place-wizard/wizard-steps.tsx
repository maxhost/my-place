import {
  StyleAssistIsland,
  type StyleSuggestion,
} from "@/features/style-assist/public";
import type { Palette } from "@/shared/lib/palette-schema";
import { PALETTE_PRESET_IDS } from "./palettes";
import { PaletteModeSelector } from "./palette-mode-selector";
import type { WizardLabels } from "./wizard-labels";

// Cuerpos presentacionales de los 3 pasos del wizard (S8b). Sin estado: el
// orquestador (`place-wizard.tsx`) tiene la máquina y las validaciones; acá
// sólo campos + textos. Tailwind sólo layout/spacing; chrome con tokens del
// producto (continuidad visual con la landing). Los colores del PLACE van por
// el preview (CSS inline), nunca clases Tailwind de color.

const fieldClass =
  "min-h-[2.75rem] rounded-lg border border-border bg-surface px-3 text-base text-ink";
const errClass = "text-sm text-accent-strong";

export function Step1Identity(p: {
  labels: WizardLabels;
  ids: { name: string; slug: string; slugMsg: string };
  name: string;
  nameTouched: boolean;
  nameValid: boolean;
  slug: string;
  slugState: "idle" | "reserved" | "invalid" | "valid";
  normalized: string;
  rootDomain: string;
  onName: (v: string) => void;
  onNameBlur: () => void;
  onSlug: (v: string) => void;
}) {
  const { labels: l } = p;
  return (
    <>
      <div className="flex flex-col gap-2">
        <label htmlFor={p.ids.name} className="text-sm font-medium text-ink">
          {l.nameLabel}
        </label>
        <input
          id={p.ids.name}
          type="text"
          value={p.name}
          placeholder={l.namePlaceholder}
          onChange={(e) => p.onName(e.target.value)}
          onBlur={p.onNameBlur}
          className={fieldClass}
        />
        {p.nameTouched && !p.nameValid && (
          <p className={errClass}>{l.nameRequired}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={p.ids.slug} className="text-sm font-medium text-ink">
          {l.slugLabel}
        </label>
        <input
          id={p.ids.slug}
          type="text"
          value={p.slug}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={p.slugState === "reserved" || p.slugState === "invalid"}
          aria-describedby={p.ids.slugMsg}
          onChange={(e) => p.onSlug(e.target.value)}
          className={fieldClass}
        />
        <div id={p.ids.slugMsg} className="text-sm" aria-live="polite">
          {p.slugState === "reserved" && (
            <p className="text-accent-strong">{l.slugReserved}</p>
          )}
          {p.slugState === "invalid" && (
            <p className="text-accent-strong">{l.slugFormat}</p>
          )}
          {p.slugState === "valid" && (
            <div className="flex flex-col gap-1 text-muted">
              <p className="text-ink">
                {l.slugHint
                  .replace("{slug}", p.normalized)
                  .replace("{domain}", p.rootDomain)}
              </p>
              <p>{l.slugAvailableHint}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function Step2Style(p: {
  labels: WizardLabels;
  ids: { desc: string };
  description: string;
  descTooLong: boolean;
  selectedPaletteId: string;
  paletteMode: "preset" | "custom";
  customPalette: Palette | null;
  onDescription: (v: string) => void;
  onPalette: (id: string) => void;
  onPaletteMode: (mode: "preset" | "custom") => void;
  onCustomHex: (token: "accent" | "bg" | "ink", value: string) => void;
  // Isla propose-only (S10b). `assist` ausente = la ruta no la cableó → no se
  // renderiza (la asistencia es opcional, ADR-0005 §5).
  assist?: {
    phase: "idle" | "loading" | "ready" | "unavailable";
    suggestReady: boolean;
    canSuggest: boolean;
    suggestion: StyleSuggestion | null;
    paletteApplied: boolean;
    descriptionApplied: boolean;
    onSuggest: () => void;
    onApplyPalette: () => void;
    onApplyDescription: () => void;
  };
}) {
  const { labels: l } = p;
  return (
    <>
      <div className="flex flex-col gap-2">
        <label htmlFor={p.ids.desc} className="text-sm font-medium text-ink">
          {l.descriptionLabel}
        </label>
        <textarea
          id={p.ids.desc}
          value={p.description}
          placeholder={l.descriptionPlaceholder}
          rows={3}
          onChange={(e) => p.onDescription(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-base text-ink"
        />
        {p.descTooLong ? (
          <p className={errClass}>{l.descriptionTooLong}</p>
        ) : (
          <p className="text-sm text-muted">{l.descriptionHint}</p>
        )}
      </div>

      {p.assist && (
        <StyleAssistIsland
          labels={l}
          phase={p.assist.phase}
          suggestReady={p.assist.suggestReady}
          canSuggest={p.assist.canSuggest}
          suggestion={p.assist.suggestion}
          paletteApplied={p.assist.paletteApplied}
          descriptionApplied={p.assist.descriptionApplied}
          onSuggest={p.assist.onSuggest}
          onApplyPalette={p.assist.onApplyPalette}
          onApplyDescription={p.assist.onApplyDescription}
        />
      )}

      <PaletteModeSelector
        labels={l}
        mode={p.paletteMode}
        presetIds={PALETTE_PRESET_IDS}
        selectedPresetId={p.selectedPaletteId}
        customPalette={p.customPalette}
        onModeChange={p.onPaletteMode}
        onPresetChange={p.onPalette}
        onCustomHexChange={p.onCustomHex}
      />
    </>
  );
}

export function Step3Account(p: {
  labels: WizardLabels;
  ids: { email: string; password: string; displayName: string };
  email: string;
  emailTouched: boolean;
  emailValid: boolean;
  password: string;
  passwordTouched: boolean;
  passwordValid: boolean;
  displayName: string;
  displayNameTouched: boolean;
  displayNameValid: boolean;
  terms: boolean;
  termsHref: string;
  privacyHref: string;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
  onDisplayName: (v: string) => void;
  onTerms: (v: boolean) => void;
}) {
  const { labels: l } = p;
  const parts = l.terms.split(/(\{terms\}|\{privacy\})/);
  return (
    <>
      <div className="flex flex-col gap-2">
        <label htmlFor={p.ids.displayName} className="text-sm font-medium text-ink">
          {l.displayNameLabel}
        </label>
        <input
          id={p.ids.displayName}
          type="text"
          value={p.displayName}
          placeholder={l.displayNamePlaceholder}
          onChange={(e) => p.onDisplayName(e.target.value)}
          className={fieldClass}
        />
        {p.displayNameTouched && !p.displayNameValid && (
          <p className={errClass}>{l.displayNameRequired}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={p.ids.email} className="text-sm font-medium text-ink">
          {l.emailLabel}
        </label>
        <input
          id={p.ids.email}
          type="email"
          value={p.email}
          placeholder={l.emailPlaceholder}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(e) => p.onEmail(e.target.value)}
          className={fieldClass}
        />
        {p.emailTouched && !p.emailValid && (
          <p className={errClass}>{l.emailInvalid}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={p.ids.password} className="text-sm font-medium text-ink">
          {l.passwordLabel}
        </label>
        <input
          id={p.ids.password}
          type="password"
          value={p.password}
          placeholder={l.passwordPlaceholder}
          onChange={(e) => p.onPassword(e.target.value)}
          className={fieldClass}
        />
        {p.passwordTouched && !p.passwordValid ? (
          <p className={errClass}>{l.passwordTooShort}</p>
        ) : (
          <p className="text-sm text-muted">{l.passwordHint}</p>
        )}
      </div>

      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={p.terms}
          onChange={(e) => p.onTerms(e.target.checked)}
          className="mt-1"
        />
        <span>
          {parts.map((part, i) => {
            if (part === "{terms}")
              return (
                <a
                  key={i}
                  href={p.termsHref}
                  className="text-accent-strong hover:underline"
                >
                  {l.termsLinkLabel}
                </a>
              );
            if (part === "{privacy}")
              return (
                <a
                  key={i}
                  href={p.privacyHref}
                  className="text-accent-strong hover:underline"
                >
                  {l.privacyLinkLabel}
                </a>
              );
            return <span key={i}>{part}</span>;
          })}
        </span>
      </label>
    </>
  );
}
