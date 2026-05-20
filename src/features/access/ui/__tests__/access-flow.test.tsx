import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccessFlow } from "../access-flow";
import type { AccessLabels, AccessSubmit } from "../access-labels";

// Tests de componente de la vía "Acceso" (S9, ADR-0008/0009 — simplificada por
// S5c del Hub V1, `docs/features/inbox/spec.md` §"Auth + redirects"): form
// account-first (login | signup) → navigate cross-subdomain al Hub. La
// elección post-auth se eliminó: el Hub V1 ya cubre "Crear un lugar" (CTA del
// estado vacío) y "Unirme" (deshabilitado allí también). jsdom + RTL.
// Seam-split: el form recibe textos por `labels` y el borde cross-system
// (Neon Auth + `window.location`) por props (`auth`, `navigate`); el wiring
// vivo del SDK Neon Auth se verifica en preview, no en vitest.

const LABELS: AccessLabels = {
  title: "Acceso",
  subtitle: "Entrá o creá tu cuenta",
  loginTab: "Iniciar sesión",
  signupTab: "Crear cuenta",
  emailLabel: "Email",
  emailPlaceholder: "vos@ejemplo.com",
  emailInvalid: "Revisá el email",
  passwordLabel: "Contraseña",
  passwordPlaceholder: "Tu contraseña",
  passwordHint: "Al menos 8 caracteres",
  passwordTooShort: "La contraseña es muy corta",
  displayNameLabel: "Tu nombre",
  displayNamePlaceholder: "Cómo te van a ver",
  displayNameRequired: "Poné tu nombre",
  terms: "Acepto los {terms} y la {privacy}.",
  termsLinkLabel: "términos",
  privacyLinkLabel: "privacidad",
  termsRequired: "Necesitás aceptar los términos",
  loginSubmit: "Entrar",
  signupSubmit: "Crear mi cuenta",
  submitting: "Un momento…",
  loginFailedNotice: "No pudimos iniciar sesión. Revisá tus datos.",
  signupFailedNotice:
    "No pudimos crear la cuenta. ¿Quizás ya tenés una? Probá iniciar sesión.",
  back: "Volver al inicio",
};

function makeAuth(over: Partial<AccessSubmit> = {}): AccessSubmit {
  return {
    login: vi.fn<AccessSubmit["login"]>(async () => ({ status: "ok" })),
    signUp: vi.fn<AccessSubmit["signUp"]>(async () => ({ status: "ok" })),
    ...over,
  };
}

function setup(opts: { auth?: AccessSubmit; navigate?: (url: string) => void } = {}) {
  const auth = opts.auth ?? makeAuth();
  const navigate = opts.navigate ?? vi.fn();
  const utils = render(
    <AccessFlow
      labels={LABELS}
      auth={auth}
      locale="es"
      termsHref="/es/terminos"
      privacyHref="/es/privacidad"
      homeHref="/es"
      navigate={navigate}
    />,
  );
  return { ...utils, auth, navigate };
}

async function login(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "vos@ejemplo.com");
  await user.type(screen.getByLabelText("Contraseña"), "supersegura");
  await user.click(screen.getByRole("button", { name: "Entrar" }));
}

describe("AccessFlow — form account-first (S9, S5c)", () => {
  it("arranca en login (email+contraseña, sin nombre) y alterna a signup", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tu nombre")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(screen.getByLabelText("Tu nombre")).toBeInTheDocument();
    expect(screen.getByText(/Acepto los/)).toBeInTheDocument();
  });

  it("login exitoso → navigate cross-subdomain al Hub en el locale activo", async () => {
    const user = userEvent.setup();
    const { auth, navigate } = setup();
    await login(user);

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("https://app.place.community/es/"),
    );
    expect(auth.login).toHaveBeenCalledWith("vos@ejemplo.com", "supersegura");
  });

  it("login fallido → aviso calmo, sigue en el form (no navega)", async () => {
    const user = userEvent.setup();
    const { navigate } = setup({
      auth: makeAuth({
        login: vi.fn<AccessSubmit["login"]>(async () => ({
          status: "login_failed",
        })),
      }),
    });
    await login(user);

    await waitFor(() =>
      expect(
        screen.getByText("No pudimos iniciar sesión. Revisá tus datos."),
      ).toBeInTheDocument(),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("signup llama auth.signUp con los datos de cuenta y navega al Hub", async () => {
    const user = userEvent.setup();
    const { auth, navigate } = setup();
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await user.type(screen.getByLabelText("Tu nombre"), "Ana");
    await user.type(screen.getByLabelText("Email"), "ana@ejemplo.com");
    await user.type(screen.getByLabelText("Contraseña"), "supersegura");
    await user.click(screen.getByLabelText(/Acepto los/));
    await user.click(screen.getByRole("button", { name: "Crear mi cuenta" }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("https://app.place.community/es/"),
    );
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "ana@ejemplo.com",
      password: "supersegura",
      displayName: "Ana",
    });
  });

  it("signup no se envía sin aceptar los términos", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await user.type(screen.getByLabelText("Tu nombre"), "Ana");
    await user.type(screen.getByLabelText("Email"), "ana@ejemplo.com");
    await user.type(screen.getByLabelText("Contraseña"), "supersegura");

    expect(
      screen.getByRole("button", { name: "Crear mi cuenta" }),
    ).toBeDisabled();
  });

  it("signup fallido → aviso calmo que sugiere iniciar sesión (no navega)", async () => {
    const user = userEvent.setup();
    const { navigate } = setup({
      auth: makeAuth({
        signUp: vi.fn<AccessSubmit["signUp"]>(async () => ({
          status: "signup_failed",
        })),
      }),
    });
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await user.type(screen.getByLabelText("Tu nombre"), "Ana");
    await user.type(screen.getByLabelText("Email"), "ana@ejemplo.com");
    await user.type(screen.getByLabelText("Contraseña"), "supersegura");
    await user.click(screen.getByLabelText(/Acepto los/));
    await user.click(screen.getByRole("button", { name: "Crear mi cuenta" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "No pudimos crear la cuenta. ¿Quizás ya tenés una? Probá iniciar sesión.",
        ),
      ).toBeInTheDocument(),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("idempotencia: doble click no dispara dos autenticaciones", async () => {
    const user = userEvent.setup();
    let resolve!: () => void;
    const auth = makeAuth({
      login: vi.fn<AccessSubmit["login"]>(
        () => new Promise((r) => (resolve = () => r({ status: "ok" }))),
      ),
    });
    const { navigate } = setup({ auth });
    await user.type(screen.getByLabelText("Email"), "vos@ejemplo.com");
    await user.type(screen.getByLabelText("Contraseña"), "supersegura");
    const btn = screen.getByRole("button", { name: "Entrar" });
    await user.click(btn);
    await user.click(btn);
    expect(auth.login).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("https://app.place.community/es/"),
    );
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
