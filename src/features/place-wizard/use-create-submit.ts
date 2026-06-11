import { useRef, useState } from "react";
import type {
  CreatePlaceInput,
  CreatePlaceResult,
  PlaceFirstCredentials,
} from "@/features/place-creation/public";
import type { WizardSignUp, WizardSubmit } from "./wizard-labels";

// Sub-hook 6/6: submit two-phase (ADR-0018). FASE 1 onCreateAccount establece
// cookie; FASE 2 onSubmit crea el place authed (auth.token() lee la cookie).
// authed se salta FASE 1. `notice` vive acá; orquestador llama clearNotice
// desde goNext/goBack. Ver mapa en `use-place-wizard.ts`.

type Notice =
  | "slug_taken"
  | "invalid"
  | "rate_limited"
  | "error"
  | "account"
  | null;

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
      } else if (res.status === "rate_limited") setNotice("rate_limited");
      else setNotice("invalid");
    } catch {
      setNotice("error");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return { submitting, notice, result, handleSubmit, clearNotice };
}
