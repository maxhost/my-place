import { useRef, useState } from "react";
import type {
  CreatePlaceInput,
  CreatePlaceResult,
  PlaceFirstCredentials,
} from "@/features/place-creation/public";
import type { WizardSignUp, WizardSubmit } from "./wizard-labels";

// use-create-submit.ts — Sub-hook 6/6 de `use-place-wizard`.
// Orquesta el submit two-phase del wizard (ADR-0018):
//   FASE 1 (place-first): `onCreateAccount(credentials)` — crea identidad y
//   setea la cookie de sesión. Sin "ok" no seguimos (sin sesión la FASE 2 no
//   podría obtener el JWT). En authed la sesión ya existe → se salta.
//   FASE 2: `onSubmit(input)` — crea el place en modo authed (`auth.token()`).
// El `notice` vive acá (su dueño natural — `handleSubmit` lo setea); el
// orquestador envuelve `goNext`/`goBack` para llamar `clearNotice()`.
// `detectTimezone()` se mueve acá (sólo `handleSubmit` lo usa al armar input).

type Notice = "slug_taken" | "invalid" | "error" | "account" | null;

// tz del browser con fallback fijo a "UTC" (IANA válido → pasa
// `timezoneSchema`). El owner ajusta el horario luego en `/settings`.
function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function useCreateSubmit(opts: {
  authed: boolean;
  onCreateAccount?: WizardSignUp;
  onSubmit: WizardSubmit;
  submitValid: boolean;
  /** Core del input (sin `ownerTimezone`, que se computa acá al submit). */
  buildInputCore: () => Omit<CreatePlaceInput, "ownerTimezone">;
  buildCredentials: () => PlaceFirstCredentials;
  /** Callback para volver al Paso 1 cuando el slug está ocupado. */
  onSlugTaken: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [result, setResult] = useState<CreatePlaceResult | null>(null);
  const submittingRef = useRef(false);

  function clearNotice() {
    setNotice(null);
  }

  async function handleSubmit() {
    // Idempotencia: el ref bloquea reentradas aunque el estado aún no haya
    // re-renderizado (doble click). El submit nunca dispara dos veces.
    if (submittingRef.current || !opts.submitValid) return;
    submittingRef.current = true;
    setSubmitting(true);
    setNotice(null);
    try {
      // FASE 1 (solo place-first): crear la cuenta. Sin "ok" no seguimos.
      if (!opts.authed) {
        const acc = await opts.onCreateAccount?.(opts.buildCredentials());
        if (!acc || acc.status !== "ok") {
          setNotice("account");
          return;
        }
      }
      // FASE 2: crear el place authed. La cookie de la FASE 1 (o la sesión
      // preexistente) viaja en ESTA request → el Server Action obtiene el JWT.
      const input: CreatePlaceInput = {
        ...opts.buildInputCore(),
        ownerTimezone: detectTimezone(),
      };
      const res = await opts.onSubmit(input);
      if (res.status === "created") setResult(res);
      else if (res.status === "slug_taken") {
        setNotice("slug_taken");
        opts.onSlugTaken();
      } else setNotice("invalid");
    } catch {
      setNotice("error");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return { submitting, notice, result, handleSubmit, clearNotice };
}
