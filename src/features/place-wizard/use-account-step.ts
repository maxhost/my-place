import { useState } from "react";

// use-account-step.ts — Sub-hook 3/6 de `use-place-wizard`.
// Paso 3 del wizard place-first: cuenta (email + password + nombre + T&C).
// Autónomo (no consume otros sub-hooks). En modo authed este paso se omite
// del UI; el orquestador decide qué cuenta para `submitValid`. `isValid`
// resume el paso (los 4 campos válidos y T&C aceptados).

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
  const isValid = emailValid && passwordValid && displayNameValid && terms;

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
    isValid,
    setEmail,
    setEmailTouched,
    setPassword,
    setPasswordTouched,
    setDisplayName,
    setDisplayNameTouched,
    setTerms,
  };
}
