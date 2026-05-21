import { useState } from "react";
import { slugSchema } from "@/features/place-creation/public";
import type { Locale } from "@/i18n/routing";
import { isReservedSlug } from "@/shared/config/reserved-slugs";
import { slugify } from "./slugify";

// Sub-hook 2/6: Paso 1 (nombre + slug + idioma del place). `onNameChange`
// deriva el slug si el owner no lo editó (`slugTouched`). `slugState` no es
// autoritativo — `UNIQUE` de DB es la verdad. `defaultLocale` arranca con
// `initialLocale` (típicamente el locale del path en `crear/page.tsx`,
// ADR-0022 + ADR-0024) y el setter alimenta el selector del Paso 1 (UI viene
// en S2b.2). Ver mapa en `use-place-wizard.ts`.

export type SlugState = "idle" | "reserved" | "invalid" | "valid";

function classifySlug(raw: string): { state: SlugState; normalized: string } {
  if (raw.trim() === "") return { state: "idle", normalized: "" };
  const parsed = slugSchema.safeParse(raw);
  if (parsed.success) return { state: "valid", normalized: parsed.data };
  if (isReservedSlug(raw)) return { state: "reserved", normalized: "" };
  return { state: "invalid", normalized: "" };
}

export function useIdentityStep(initialLocale: Locale) {
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  // El locale del place es enum cerrado (`routing.locales`) — no tiene estado
  // "inválido"; por eso no participa de `step1Valid`. El selector siempre
  // arranca con un valor legal (la prop) y sólo se cambia a otro valor legal.
  const [defaultLocale, setDefaultLocale] = useState<Locale>(initialLocale);

  const { state: slugState, normalized } = classifySlug(slug);
  const nameValid = name.trim().length >= 1 && name.trim().length <= 80;
  const step1Valid = nameValid && slugState === "valid";

  function onNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  return {
    name,
    nameTouched,
    nameValid,
    slug,
    slugTouched,
    slugState,
    normalized,
    step1Valid,
    defaultLocale,
    setDefaultLocale,
    onNameChange,
    setNameTouched,
    setSlug,
    setSlugTouched,
  };
}
