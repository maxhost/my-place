import { useId, useRef, useState } from "react";
import type { AccessLabels, AccessSubmit } from "./access-labels";

// Máquina de estado de la vía "Acceso" (S9, ADR-0008/0009), separada del
// render por el límite de archivo (CLAUDE.md ≤300) y para testear por
// comportamiento. account-first: login | signup → al autenticar se ofrece
// "Crear mi place" (modo authed) / "Unirme" (deshabilitado, ADR-0009 §2).
// Idempotencia por ref (mismo patrón que el wizard, S8b).

type Mode = "login" | "signup";
type Phase = "form" | "choice" | "create";
type Notice = "login_failed" | "signup_failed" | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function useAccessForm(opts: {
  labels: AccessLabels;
  auth: AccessSubmit;
}) {
  const { labels } = opts;
  const [mode, setMode] = useState<Mode>("login");
  const [phase, setPhase] = useState<Phase>("form");
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
      if (res.status === "ok") setPhase("choice");
      else setNotice(res.status);
    } catch {
      setNotice(isSignup ? "signup_failed" : "login_failed");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function goCreate() {
    setPhase("create");
  }

  const noticeText =
    notice === "login_failed"
      ? labels.loginFailedNotice
      : notice === "signup_failed"
        ? labels.signupFailedNotice
        : null;

  return {
    ids,
    mode,
    isSignup,
    phase,
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
    goCreate,
  };
}
