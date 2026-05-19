import { useState } from "react";

// Sub-hook 5/6: Paso 3 (cuenta place-first: email + password + nombre + T&C).
// En modo authed este paso no se renderiza. `step3Valid` resume el paso (los
// 4 campos válidos y T&C aceptados). Ver mapa en `use-place-wizard.ts`.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function useAccountStep() {
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [displayNameTouched, setDisplayNameTouched] = useState(false);
  const [terms, setTerms] = useState(false);

  const emailValid = EMAIL_RE.test(email.trim());
  const passwordValid = password.length >= 8;
  const displayNameValid =
    displayName.trim().length >= 1 && displayName.trim().length <= 80;
  const step3Valid = emailValid && passwordValid && displayNameValid && terms;

  return {
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
    step3Valid,
    setEmail,
    setEmailTouched,
    setPassword,
    setPasswordTouched,
    setDisplayName,
    setDisplayNameTouched,
    setTerms,
  };
}
