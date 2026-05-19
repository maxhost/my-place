import { useState } from "react";
import { slugSchema } from "@/features/place-creation/public";
import { isReservedSlug } from "@/shared/config/reserved-slugs";
import { slugify } from "./slugify";

// use-identity-step.ts — Sub-hook 2/6 de `use-place-wizard`.
// Paso 1 del wizard: nombre del lugar + slug. Autónomo (no consume otros
// sub-hooks). `onNameChange` deriva el slug a partir del nombre si el owner
// aún no editó el slug a mano (`slugTouched`). `slugState` clasifica
// reservado / inválido / válido (no autoritativo — el `UNIQUE` de DB es la
// verdad). `isValid` resume el paso para la validez global del wizard.

export type SlugState = "idle" | "reserved" | "invalid" | "valid";

function classifySlug(raw: string): { state: SlugState; normalized: string } {
  if (raw.trim() === "") return { state: "idle", normalized: "" };
  const parsed = slugSchema.safeParse(raw);
  if (parsed.success) return { state: "valid", normalized: parsed.data };
  if (isReservedSlug(raw)) return { state: "reserved", normalized: "" };
  return { state: "invalid", normalized: "" };
}

export function useIdentityStep() {
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const { state: slugState, normalized } = classifySlug(slug);
  const nameValid = name.trim().length >= 1 && name.trim().length <= 80;
  const isValid = nameValid && slugState === "valid";

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
    isValid,
    onNameChange,
    setNameTouched,
    setSlug,
    setSlugTouched,
  };
}
