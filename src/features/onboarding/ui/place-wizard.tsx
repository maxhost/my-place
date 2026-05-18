"use client";

import { useId, useState } from "react";
import { isReservedSlug } from "@/shared/config/reserved-slugs";
import { PAPEL_PALETTE } from "../domain/defaults";
import { slugSchema } from "../domain/schema";
import { PlacePreview } from "./place-preview";
import { slugify } from "./slugify";

// Wizard place-first (S8a: shell + Paso 1 + preview en vivo). Componente
// CLIENTE: estado del formulario client-side hasta el submit (S8b). Recibe
// sus textos por prop `labels` (serializable, sin runtime i18n en el cliente
// → menor bundle y testeable sin provider; el Server Component de la ruta los
// traduce con next-intl en S8b). Los Pasos 2/3 + submit + ruta llegan en S8b.
//
// El producto es un wizard de 3 pasos (`producto.md` cozytech: nada grita,
// sin urgencia). El progreso muestra "Paso n de 3" desde ya; S8a sólo define
// el Paso 1 (Identidad) → no hay paso siguiente al que avanzar todavía.

const TOTAL_STEPS = 3;

export interface WizardLabels {
  title: string;
  /** Plantilla con `{n}` y `{total}`, ej. "Paso {n} de {total}". */
  progress: string;
  /** Títulos de los pasos definidos (S8a: solo "Identidad"). */
  stepTitles: string[];
  next: string;
  back: string;
  nameLabel: string;
  namePlaceholder: string;
  slugLabel: string;
  /** Plantilla con `{slug}` y `{domain}`, ej. "{slug}.{domain}". */
  slugHint: string;
  slugReserved: string;
  slugFormat: string;
  slugAvailableHint: string;
  nameRequired: string;
  previewLabel: string;
  previewEmptyName: string;
  guardrailNotice: string;
}

type SlugState = "idle" | "reserved" | "invalid" | "valid";

function classifySlug(raw: string): { state: SlugState; normalized: string } {
  if (raw.trim() === "") return { state: "idle", normalized: "" };
  const parsed = slugSchema.safeParse(raw);
  if (parsed.success) return { state: "valid", normalized: parsed.data };
  if (isReservedSlug(raw)) return { state: "reserved", normalized: "" };
  return { state: "invalid", normalized: "" };
}

export function PlaceWizard({
  labels,
  rootDomain,
}: {
  labels: WizardLabels;
  rootDomain: string;
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const nameId = useId();
  const slugId = useId();
  const slugMsgId = useId();

  const { state: slugState, normalized } = classifySlug(slug);
  const nameValid = name.trim().length >= 1 && name.trim().length <= 80;
  const step1Valid = nameValid && slugState === "valid";

  // S8a define un solo paso (Identidad) → no hay siguiente todavía. S8b suma
  // los pasos 2/3 y habilita el avance + submit.
  const definedSteps = labels.stepTitles.length;
  const hasNextStep = currentStep < definedSteps - 1;

  function onNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  function onSlugChange(value: string) {
    setSlug(value);
    setSlugTouched(true);
  }

  const progress = labels.progress
    .replace("{n}", String(currentStep + 1))
    .replace("{total}", String(TOTAL_STEPS));

  return (
    <section className="mx-auto grid w-full max-w-[64rem] gap-10 px-6 py-12 md:grid-cols-[1.05fr_0.95fr]">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-3xl text-ink">{labels.title}</h1>
          <p className="text-sm text-muted">{progress}</p>
        </header>

        <h2 className="text-xl text-ink">{labels.stepTitles[currentStep]}</h2>

        <div className="flex flex-col gap-2">
          <label htmlFor={nameId} className="text-sm font-medium text-ink">
            {labels.nameLabel}
          </label>
          <input
            id={nameId}
            type="text"
            value={name}
            placeholder={labels.namePlaceholder}
            onChange={(e) => onNameChange(e.target.value)}
            onBlur={() => setNameTouched(true)}
            className="min-h-[2.75rem] rounded-lg border border-border bg-surface px-3 text-base text-ink"
          />
          {nameTouched && !nameValid && (
            <p className="text-sm text-accent-strong">{labels.nameRequired}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={slugId} className="text-sm font-medium text-ink">
            {labels.slugLabel}
          </label>
          <input
            id={slugId}
            type="text"
            value={slug}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={slugState === "reserved" || slugState === "invalid"}
            aria-describedby={slugMsgId}
            onChange={(e) => onSlugChange(e.target.value)}
            className="min-h-[2.75rem] rounded-lg border border-border bg-surface px-3 text-base text-ink"
          />
          <div id={slugMsgId} className="text-sm">
            {slugState === "reserved" && (
              <p className="text-accent-strong">{labels.slugReserved}</p>
            )}
            {slugState === "invalid" && (
              <p className="text-accent-strong">{labels.slugFormat}</p>
            )}
            {slugState === "valid" && (
              <div className="flex flex-col gap-1 text-muted">
                <p className="text-ink">
                  {labels.slugHint
                    .replace("{slug}", normalized)
                    .replace("{domain}", rootDomain)}
                </p>
                <p>{labels.slugAvailableHint}</p>
              </div>
            )}
          </div>
        </div>

        <footer className="flex items-center gap-3 pt-2">
          <button
            type="button"
            disabled={currentStep === 0}
            onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
            className="inline-flex min-h-[2.75rem] items-center rounded-lg border border-border px-5 text-base text-ink disabled:opacity-40"
          >
            {labels.back}
          </button>
          <button
            type="button"
            disabled={!step1Valid || !hasNextStep}
            onClick={() =>
              setCurrentStep((s) => Math.min(definedSteps - 1, s + 1))
            }
            className="cta inline-flex min-h-[2.75rem] items-center rounded-lg px-6 text-base font-medium disabled:opacity-40"
          >
            {labels.next}
          </button>
        </footer>
      </div>

      <aside className="md:pt-2">
        <PlacePreview
          name={name}
          palette={PAPEL_PALETTE}
          labels={{
            previewLabel: labels.previewLabel,
            previewEmptyName: labels.previewEmptyName,
            guardrailNotice: labels.guardrailNotice,
          }}
        />
      </aside>
    </section>
  );
}
