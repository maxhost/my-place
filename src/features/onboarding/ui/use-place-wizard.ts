import { useId, useRef, useState } from "react";
import { isReservedSlug } from "@/shared/config/reserved-slugs";
import type { CreatePlaceResult } from "../create-place";
import type { CreatePlaceInput } from "../domain/schema";
import { slugSchema } from "../domain/schema";
import { DEFAULT_PRESET_ID, PALETTE_PRESETS } from "./palettes";
import { slugify } from "./slugify";
import type { WizardLabels, WizardSubmit } from "./wizard-labels";

// Máquina de estado del wizard (S8b), separada del render para no exceder el
// límite de archivo (CLAUDE.md ≤300) y para testear la UI por comportamiento.
// El estado vive client-side hasta el submit; idempotencia por ref.

type SlugState = "idle" | "reserved" | "invalid" | "valid";
type Notice = "slug_taken" | "invalid" | "error" | null;

function classifySlug(raw: string): { state: SlugState; normalized: string } {
  if (raw.trim() === "") return { state: "idle", normalized: "" };
  const parsed = slugSchema.safeParse(raw);
  if (parsed.success) return { state: "valid", normalized: parsed.data };
  if (isReservedSlug(raw)) return { state: "reserved", normalized: "" };
  return { state: "invalid", normalized: "" };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// tz del browser con fallback fijo a "UTC" (IANA válido → pasa
// `timezoneSchema`). El owner ajusta el horario luego en `/settings`.
function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function usePlaceWizard(opts: {
  labels: WizardLabels;
  onSubmit: WizardSubmit;
}) {
  const { labels } = opts;
  const [currentStep, setCurrentStep] = useState(0);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [paletteId, setPaletteId] = useState(DEFAULT_PRESET_ID);
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [displayNameTouched, setDisplayNameTouched] = useState(false);
  const [terms, setTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [result, setResult] = useState<CreatePlaceResult | null>(null);
  const submittingRef = useRef(false);

  const ids = {
    name: useId(),
    slug: useId(),
    slugMsg: useId(),
    desc: useId(),
    email: useId(),
    password: useId(),
    displayName: useId(),
  };

  const { state: slugState, normalized } = classifySlug(slug);
  const nameValid = name.trim().length >= 1 && name.trim().length <= 80;
  const descTooLong = description.trim().length > 500;
  const emailValid = EMAIL_RE.test(email.trim());
  const passwordValid = password.length >= 8;
  const displayNameValid =
    displayName.trim().length >= 1 && displayName.trim().length <= 80;

  const step1Valid = nameValid && slugState === "valid";
  const step3Valid = emailValid && passwordValid && displayNameValid && terms;
  const stepValid = [step1Valid, !descTooLong, step3Valid];

  const selectedPalette =
    PALETTE_PRESETS.find((p) => p.id === paletteId)?.palette ??
    PALETTE_PRESETS[0].palette;

  const stepCount = labels.stepTitles.length;
  const isLastStep = currentStep === stepCount - 1;

  function onNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  function goNext() {
    if (!stepValid[currentStep] || isLastStep) return;
    setNotice(null);
    setCurrentStep((s) => Math.min(stepCount - 1, s + 1));
  }

  function goBack() {
    setNotice(null);
    setCurrentStep((s) => Math.max(0, s - 1));
  }

  async function handleSubmit() {
    // Idempotencia: el ref bloquea reentradas aunque el estado aún no haya
    // re-renderizado (doble click). El submit nunca dispara dos veces.
    if (submittingRef.current || !step3Valid) return;
    submittingRef.current = true;
    setSubmitting(true);
    setNotice(null);
    try {
      const input: CreatePlaceInput = {
        name: name.trim(),
        slug: normalized,
        description: description.trim() || undefined,
        theme: selectedPalette,
        ownerTimezone: detectTimezone(),
      };
      const res = await opts.onSubmit(input, {
        email: email.trim(),
        password,
        displayName: displayName.trim(),
      });
      if (res.status === "created") setResult(res);
      else if (res.status === "slug_taken") {
        setNotice("slug_taken");
        setCurrentStep(0);
      } else setNotice("invalid");
    } catch {
      setNotice("error");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const progress = labels.progress
    .replace("{n}", String(currentStep + 1))
    .replace("{total}", String(stepCount));

  const noticeText =
    notice === "slug_taken"
      ? labels.slugTakenNotice
      : notice === "invalid"
        ? labels.invalidNotice
        : notice === "error"
          ? labels.errorNotice
          : null;

  return {
    ids,
    currentStep,
    isLastStep,
    progress,
    noticeText,
    result,
    submitting,
    step3Valid,
    stepValid,
    selectedPalette,
    name,
    nameTouched,
    nameValid,
    slug,
    slugState,
    normalized,
    description,
    descTooLong,
    paletteId,
    email,
    emailTouched,
    emailValid,
    password,
    passwordTouched,
    passwordValid,
    displayName,
    displayNameTouched,
    displayNameValid,
    terms,
    onNameChange,
    setNameTouched,
    setSlug,
    setSlugTouched,
    setDescription,
    setPaletteId,
    setEmail,
    setEmailTouched,
    setPassword,
    setPasswordTouched,
    setDisplayName,
    setDisplayNameTouched,
    setTerms,
    goNext,
    goBack,
    handleSubmit,
  };
}
