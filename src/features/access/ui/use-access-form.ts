import { useId, useRef, useState } from "react";
import type { AccessLabels, AccessSubmit } from "./access-labels";

// Máquina de estado de la vía "Acceso" (S9, ADR-0008/0009 — simplificada por
// S5c del Hub V1, `docs/features/inbox/spec.md` §"Auth + redirects"),
// separada del render por el límite de archivo (CLAUDE.md ≤300) y para
// testear por comportamiento. account-first: login | signup → al autenticar
// se dispara `onSuccess()` (la ruta lo cablea para navegar al Hub
// cross-subdomain). La elección post-auth y el modo "create" del wizard
// authed (que vivía en este slice) se eliminaron: el Hub V1 ya cubre esos
// flujos (CTA "Crear un lugar" del estado vacío → `/crear?from=hub` →
// wizard authed). Idempotencia por ref (mismo patrón que el wizard, S8b).

type Mode = "login" | "signup";
type Notice =
  | "login_failed"
  | "signup_failed"
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function useAccessForm(opts: {
  labels: AccessLabels;
  auth: AccessSubmit;
  /** Callback disparado en login/signup exitoso (la ruta navega al Hub). */
  onSuccess: () => void;
  /** ADR-0045 §D3 — tab activo al primer render. Default `"login"`. Sólo
   *  decide initial state; post-mount el user switchea via `switchMode()`. */
  initialMode?: Mode;
}) {
  const { labels } = opts;
  const [mode, setMode] = useState<Mode>(opts.initialMode ?? "login");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [displayNameTouched, setDisplayNameTouched] = useState(false);
  const [terms, setTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const submittingRef = useRef(false);

  const ids = {
    email: useId(),
    password: useId(),
    displayName: useId(),
  };

  const isSignup = mode === "signup";
  const emailValid = EMAIL_RE.test(email.trim());
  const passwordValid = password.length >= 8;
  const displayNameValid =
    displayName.trim().length >= 1 && displayName.trim().length <= 80;

  const canSubmit =
    emailValid &&
    passwordValid &&
    (!isSignup || (displayNameValid && terms));

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setNotice(null);
  }

  async function handleSubmit() {
    // Idempotencia: el ref bloquea reentradas aunque el estado no haya
    // re-renderizado (doble click). Nunca dispara dos autenticaciones.
    if (submittingRef.current || !canSubmit) return;
    submittingRef.current = true;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = isSignup
        ? await opts.auth.signUp({
            email: email.trim(),
            password,
            displayName: displayName.trim(),
          })
        : await opts.auth.login(email.trim(), password);
      if (res.status === "ok") opts.onSuccess();
      else if (res.status === "rate_limited") {
        setNotice({
          kind: "rate_limited",
          retryAfterSeconds: res.retryAfterSeconds,
        });
      } else {
        setNotice(res.status);
      }
    } catch {
      setNotice(isSignup ? "signup_failed" : "login_failed");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const noticeText = (() => {
    if (notice === null) return null;
    if (notice === "login_failed") return labels.loginFailedNotice;
    if (notice === "signup_failed") return labels.signupFailedNotice;
    // rate_limited — interpolación `{seconds}` client-side.
    return labels.rateLimitedNotice.replaceAll(
      "{seconds}",
      String(notice.retryAfterSeconds),
    );
  })();

  return {
    ids,
    mode,
    isSignup,
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
    submitting,
    canSubmit,
    noticeText,
    setEmail,
    setEmailTouched,
    setPassword,
    setPasswordTouched,
    setDisplayName,
    setDisplayNameTouched,
    setTerms,
    switchMode,
    handleSubmit,
  };
}
