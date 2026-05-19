import { useId, useRef, useState } from "react";
import type { StyleSuggestion } from "@/features/style-assist/public";
import { isReservedSlug } from "@/shared/config/reserved-slugs";
import type { Palette } from "@/shared/lib/palette-schema";
import {
  type CreatePlaceInput,
  type CreatePlaceResult,
  slugSchema,
} from "@/features/place-creation/public";
import { DEFAULT_PRESET_ID, PALETTE_PRESETS } from "./palettes";
import { slugify } from "./slugify";
import type {
  WizardLabels,
  WizardSignUp,
  WizardSubmit,
  WizardSuggest,
} from "./wizard-labels";

// Máquina de estado del wizard (S8b), separada del render para no exceder el
// límite de archivo (CLAUDE.md ≤300) y para testear la UI por comportamiento.
// El estado vive client-side hasta el submit; idempotencia por ref.

type SlugState = "idle" | "reserved" | "invalid" | "valid";
type Notice = "slug_taken" | "invalid" | "error" | "account" | null;

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

type SuggestPhase = "idle" | "loading" | "ready" | "unavailable";

export function usePlaceWizard(opts: {
  labels: WizardLabels;
  onSubmit: WizardSubmit;
  /**
   * Modo authed (S9, vía "Acceso"): el usuario ya está autenticado → se
   * omite el Paso 3 (cuenta) y el submit no envía credenciales (ADR-0008 §3).
   * El nº de pasos lo da `labels.stepTitles.length` (la ruta pasa 2 títulos).
   */
  authed?: boolean;
  /**
   * Place-first: crea la cuenta en una request PREVIA (establece la cookie de
   * sesión) antes del `onSubmit` authed. Requerido cuando `!authed`.
   */
  onCreateAccount?: WizardSignUp;
  /**
   * Asistencia LLM propose-only (S10b). OPCIONAL: si no se cablea, la isla
   * no se renderiza (la asistencia es opcional — ADR-0005 §5).
   */
  onSuggest?: WizardSuggest;
}) {
  const { labels, authed = false } = opts;
  const [currentStep, setCurrentStep] = useState(0);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [paletteId, setPaletteId] = useState(DEFAULT_PRESET_ID);
  // Override de paleta cuando el owner aplica la propuesta del LLM (S10b).
  // `null` = manda el preset; al elegir un preset se limpia (el preset gana).
  const [customPalette, setCustomPalette] = useState<Palette | null>(null);
  const [suggestPhase, setSuggestPhase] = useState<SuggestPhase>("idle");
  const [suggestion, setSuggestion] = useState<StyleSuggestion | null>(null);
  const [paletteApplied, setPaletteApplied] = useState(false);
  const [descriptionApplied, setDescriptionApplied] = useState(false);
  const suggestingRef = useRef(false);
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
  // Validez del último paso para habilitar "Crear": en authed el último paso
  // es Estilo (sin cuenta), en place-first es el Paso 3 (cuenta).
  const submitValid = authed ? step1Valid && !descTooLong : step3Valid;

  const presetPalette =
    PALETTE_PRESETS.find((p) => p.id === paletteId)?.palette ??
    PALETTE_PRESETS[0].palette;
  // La paleta aplicada del LLM (si la hay) gana sobre el preset hasta que el
  // owner elige un preset a mano (propose-only — nada queda fijado solo).
  const selectedPalette = customPalette ?? presetPalette;

  const canSuggest =
    !!opts.onSuggest && suggestPhase !== "loading";
  const suggestReady = description.trim().length > 0;

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
    if (submittingRef.current || !submitValid) return;
    submittingRef.current = true;
    setSubmitting(true);
    setNotice(null);
    try {
      // FASE 1 (solo place-first): crear la cuenta. Es una request propia
      // que establece la cookie de sesión; sin "ok" no seguimos (sin sesión
      // la FASE 2 no podría obtener el JWT). En authed la sesión ya existe.
      if (!authed) {
        const acc = await opts.onCreateAccount?.({
          email: email.trim(),
          password,
          displayName: displayName.trim(),
        });
        if (!acc || acc.status !== "ok") {
          setNotice("account");
          return;
        }
      }
      // FASE 2: crear el place en modo authed. La cookie de la FASE 1 (o la
      // sesión preexistente en authed) viaja en ESTA request → el Server
      // Action obtiene el JWT vía `auth.token()`.
      const input: CreatePlaceInput = {
        name: name.trim(),
        slug: normalized,
        description: description.trim() || undefined,
        theme: selectedPalette,
        ownerTimezone: detectTimezone(),
      };
      const res = await opts.onSubmit(input);
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

  // Elegir un preset a mano gana sobre la paleta sugerida (propose-only).
  function choosePreset(id: string) {
    setPaletteId(id);
    setCustomPalette(null);
    setPaletteApplied(false);
  }

  // Pide la propuesta. NUNCA lanza: la asistencia es opcional — falla/red/
  // `unavailable` → aviso calmo, se sigue a mano (ADR-0005 §5). Nada se
  // auto-aplica: sólo deja la propuesta visible (ADR-0005 §6).
  async function handleSuggest() {
    if (!opts.onSuggest || suggestingRef.current || !suggestReady) return;
    suggestingRef.current = true;
    setSuggestPhase("loading");
    try {
      const res = await opts.onSuggest(description.trim());
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
    setCustomPalette(suggestion.palette);
    setPaletteApplied(true);
  }

  function applySuggestedDescription() {
    if (!suggestion) return;
    setDescription(suggestion.descriptionDraft);
    setDescriptionApplied(true);
  }

  const progress = labels.progress
    .replace("{n}", String(currentStep + 1))
    .replace("{total}", String(stepCount));

  const noticeText: string | null = notice
    ? {
        slug_taken: labels.slugTakenNotice,
        account: labels.accountFailedNotice,
        invalid: labels.invalidNotice,
        error: labels.errorNotice,
      }[notice]
    : null;

  return {
    ids,
    currentStep,
    isLastStep,
    progress,
    noticeText,
    result,
    submitting,
    submitValid,
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
    suggestEnabled: !!opts.onSuggest,
    suggestPhase,
    suggestReady,
    canSuggest,
    suggestion,
    paletteApplied,
    descriptionApplied,
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
    choosePreset,
    handleSuggest,
    applySuggestedPalette,
    applySuggestedDescription,
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
