import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccessFlow } from "../access-flow";
import type { AccessLabels, AccessSubmit } from "../access-labels";
import type { WizardLabels, WizardSubmit } from "../place-wizard";

// Tests de componente de la vía "Acceso" (S9, ADR-0008/0009): form
// account-first (login | signup) → elección post-auth ("Crear mi place"
// funcional / "Unirme" deshabilitado "próximamente", ADR-0009 §2) → wizard
// reutilizado en modo authed (sin paso de cuenta). jsdom + RTL. Mismo
// seam-split que S8b: el form recibe textos por `labels` y el borde
// cross-system por props (`auth`, `onCreatePlace`); el wiring vivo del SDK
// Neon Auth se verifica en preview, no en vitest.

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
  choiceTitle: "¿Qué querés hacer?",
  choiceSubtitle: "Ya estás dentro.",
  createPlace: "Crear mi place",
  createPlaceDesc: "Armá tu lugar desde cero",
  joinPlace: "Unirme a un place",
  joinPlaceDesc: "Entrá a un lugar que ya existe",
  comingSoon: "Próximamente",
  back: "Volver al inicio",
};

const WIZARD_LABELS: WizardLabels = {
  title: "Creá tu lugar",
  progress: "Paso {n} de {total}",
  stepTitles: ["Identidad", "Estilo"],
  next: "Siguiente",
  back: "Atrás",
  create: "Crear mi lugar",
  creating: "Creando…",
  nameLabel: "Nombre del lugar",
  namePlaceholder: "El nombre que verán al entrar",
  slugLabel: "Dirección",
  slugHint: "{slug}.{domain}",
  slugReserved: "Esa dirección está reservada",
  slugFormat: "Solo minúsculas, números y guiones (mín. 3)",
  slugAvailableHint: "La disponibilidad final se confirma al crear el lugar",
  nameRequired: "Poné un nombre para tu lugar",
  previewLabel: "Así se va a ver",
  previewEmptyName: "Tu lugar",
  guardrailNotice: "Ajustamos un color para que se lea bien",
  descriptionLabel: "Descripción",
  descriptionPlaceholder: "Una línea sobre tu lugar",
  descriptionHint: "Opcional. Hasta 500 caracteres.",
  descriptionTooLong: "La descripción es demasiado larga",
  paletteLabel: "Colores",
  paletteNames: { papel: "Papel", bosque: "Bosque", tinta: "Tinta", arcilla: "Arcilla" },
  emailLabel: "Email",
  emailPlaceholder: "vos@ejemplo.com",
  emailInvalid: "Revisá el email",
  passwordLabel: "Contraseña",
  passwordPlaceholder: "Al menos 8 caracteres",
  passwordHint: "Al menos 8 caracteres",
  passwordTooShort: "La contraseña es muy corta",
  displayNameLabel: "Tu nombre",
  displayNamePlaceholder: "Cómo te van a ver",
  displayNameRequired: "Poné tu nombre",
  terms: "Acepto los {terms} y la {privacy}.",
  termsLinkLabel: "términos",
  privacyLinkLabel: "privacidad",
  termsRequired: "Necesitás aceptar los términos",
  successTitle: "Tu lugar está listo",
  successBody: "Ya podés entrar en {url}.",
  successOpen: "Abrir mi lugar",
  slugTakenNotice: "Esa dirección ya tiene dueño, probá con otra",
  invalidNotice: "Revisá los datos e intentá de nuevo",
  errorNotice: "No pudimos crear tu lugar. Probá de nuevo en un momento.",
};

function makeAuth(over: Partial<AccessSubmit> = {}): AccessSubmit {
  return {
    login: vi.fn<AccessSubmit["login"]>(async () => ({ status: "ok" })),
    signUp: vi.fn<AccessSubmit["signUp"]>(async () => ({ status: "ok" })),
    ...over,
  };
}

function setup(opts: {
  auth?: AccessSubmit;
  onCreatePlace?: WizardSubmit;
} = {}) {
  const auth = opts.auth ?? makeAuth();
  const onCreatePlace =
    opts.onCreatePlace ??
    vi.fn<WizardSubmit>(async () => ({
      status: "created",
      placeId: "p1",
      slug: "mi-club",
      adjustments: [],
    }));
  const utils = render(
    <AccessFlow
      labels={LABELS}
      wizardLabels={WIZARD_LABELS}
      auth={auth}
      onCreatePlace={onCreatePlace}
      rootDomain="place.community"
      termsHref="/es/terminos"
      privacyHref="/es/privacidad"
      homeHref="/es"
    />,
  );
  return { ...utils, auth, onCreatePlace };
}

async function login(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "vos@ejemplo.com");
  await user.type(screen.getByLabelText("Contraseña"), "supersegura");
  await user.click(screen.getByRole("button", { name: "Entrar" }));
}

describe("AccessFlow — form account-first (S9)", () => {
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

  it("login exitoso → pantalla de elección (crear activo, unirme próximamente)", async () => {
    const user = userEvent.setup();
    const { auth } = setup();
    await login(user);

    await waitFor(() =>
      expect(screen.getByText("¿Qué querés hacer?")).toBeInTheDocument(),
    );
    expect(auth.login).toHaveBeenCalledWith("vos@ejemplo.com", "supersegura");
    expect(
      screen.getByRole("button", { name: /Crear mi place/ }),
    ).toBeEnabled();
    const join = screen.getByRole("button", { name: /Unirme a un place/ });
    expect(join).toBeDisabled();
    expect(screen.getByText("Próximamente")).toBeInTheDocument();
  });

  it("login fallido → aviso calmo, sigue en el form", async () => {
    const user = userEvent.setup();
    setup({
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
    expect(screen.queryByText("¿Qué querés hacer?")).not.toBeInTheDocument();
  });

  it("signup llama auth.signUp con los datos de cuenta y avanza a elección", async () => {
    const user = userEvent.setup();
    const { auth } = setup();
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await user.type(screen.getByLabelText("Tu nombre"), "Ana");
    await user.type(screen.getByLabelText("Email"), "ana@ejemplo.com");
    await user.type(screen.getByLabelText("Contraseña"), "supersegura");
    await user.click(screen.getByLabelText(/Acepto los/));
    await user.click(screen.getByRole("button", { name: "Crear mi cuenta" }));

    await waitFor(() =>
      expect(screen.getByText("¿Qué querés hacer?")).toBeInTheDocument(),
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

  it("signup fallido → aviso calmo que sugiere iniciar sesión", async () => {
    const user = userEvent.setup();
    setup({
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
  });

  it("idempotencia: doble click no dispara dos autenticaciones", async () => {
    const user = userEvent.setup();
    let resolve!: () => void;
    const auth = makeAuth({
      login: vi.fn<AccessSubmit["login"]>(
        () => new Promise((r) => (resolve = () => r({ status: "ok" }))),
      ),
    });
    setup({ auth });
    await user.type(screen.getByLabelText("Email"), "vos@ejemplo.com");
    await user.type(screen.getByLabelText("Contraseña"), "supersegura");
    const btn = screen.getByRole("button", { name: "Entrar" });
    await user.click(btn);
    await user.click(btn);
    expect(auth.login).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() =>
      expect(screen.getByText("¿Qué querés hacer?")).toBeInTheDocument(),
    );
  });
});

describe("AccessFlow — modo authed: crear place reutilizando el wizard (S9)", () => {
  it("'Crear mi place' monta el wizard authed y crea sin re-pedir cuenta", async () => {
    const user = userEvent.setup();
    const onCreatePlace = vi.fn<WizardSubmit>(async () => ({
      status: "created",
      placeId: "p1",
      slug: "mi-club",
      adjustments: [],
    }));
    setup({ onCreatePlace });
    await login(user);
    await waitFor(() =>
      expect(screen.getByText("¿Qué querés hacer?")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Crear mi place/ }));

    // Wizard en modo authed: 2 pasos, nunca pide email/contraseña.
    expect(screen.getByText("Paso 1 de 2")).toBeInTheDocument();
    expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Nombre del lugar"), "Mi Club");
    await user.clear(screen.getByLabelText("Dirección"));
    await user.type(screen.getByLabelText("Dirección"), "mi-club");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await user.click(screen.getByRole("button", { name: "Crear mi lugar" }));

    await waitFor(() =>
      expect(screen.getByText("Tu lugar está listo")).toBeInTheDocument(),
    );
    expect(onCreatePlace).toHaveBeenCalledTimes(1);
    const [, credentials] = onCreatePlace.mock.calls[0];
    expect(credentials).toBeUndefined();
  });
});
