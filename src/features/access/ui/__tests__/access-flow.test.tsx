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
  rateLimitedNotice:
    "Demasiados intentos. Esperá {seconds} segundos y volvé a intentar.",
  back: "Volver al inicio",
  inviteTitle: "Te invitan a unirte a {placeName}",
  inviteSubtitle:
    "Entrá a tu cuenta o creá una nueva para aceptar la invitación.",
  inviteAcceptHint: "Después te llevamos a aceptar la invitación.",
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
  navigate?: (url: string) => void;
  /** ADR-0033 §"Wire-up AccessFlow": override post-auth opcional (ya
   *  validado server-side por `validateLoginReturnTo` en la page apex). */
  returnTo?: string;
  /** ADR-0045 §D3: override del tab inicial. Default `undefined` → tab
   *  login activo (mismo comportamiento que pre-V1.1-S5). */
  initialMode?: "login" | "signup";
  /** ADR-0046 §D2 + §D3 (V1.2 Sesión B): branding apex del invite flow. */
  inviteContext?: {
    placeSlug: string;
    placeName: string;
    postCredentialUrl: string;
  };
} = {}) {
  const auth = opts.auth ?? makeAuth();
  const navigate = opts.navigate ?? vi.fn();
  const utils = render(
    <AccessFlow
      labels={LABELS}
      auth={auth}
      locale="es"
      returnTo={opts.returnTo}
      initialMode={opts.initialMode}
      inviteContext={opts.inviteContext}
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

  // ADR-0033 (S11.3.C) — cold-start SSO M1: cuando la page apex propaga un
  // `returnTo` ya validado server-side (allowlist `sso-issue`/`sso-init` +
  // same-registrable-domain + HTTPS, ver `validateLoginReturnTo`), el form
  // honra ese destino en lugar del Hub canónico. Sin returnTo → Hub default
  // (backwards-compat con signup/login pre-Feature-C; covered en regression).
  it("respeta returnTo si la page lo propaga → navigate al destino SSO en vez del Hub", async () => {
    const user = userEvent.setup();
    const returnTo =
      "https://place.community/api/auth/sso-issue?aud=nocodecompany.co&state=abc&nonce=def&returnTo=%2Fsettings";
    const { auth, navigate } = setup({ returnTo });
    await login(user);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(returnTo));
    expect(navigate).not.toHaveBeenCalledWith(
      "https://app.place.community/es/",
    );
    expect(auth.login).toHaveBeenCalledWith("vos@ejemplo.com", "supersegura");
  });

  it("regression: sin returnTo → Hub canónico (flows pre-Feature-C intactos)", async () => {
    const user = userEvent.setup();
    const { navigate } = setup({ returnTo: undefined });
    await login(user);

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("https://app.place.community/es/"),
    );
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  // ADR-0045 §D3 — invite signup CTA: el page apex `/login` parsea
  // `searchParams.mode` (whitelist `"login"|"signup"`, fallback `"login"`) y
  // lo propaga como `initialMode`. Sin el param, el comportamiento es
  // idéntico al pre-V1.1-S5 (tab login default, covered en regression del
  // primer test del suite). Con `initialMode="signup"` el form arranca con
  // el tab signup activo (CTA "Crear cuenta" del invite no requiere click
  // extra). Post-mount el user sigue pudiendo switchear via los botones —
  // este test valida sólo el initial state.
  it("ADR-0045: initialMode=\"signup\" arranca con tab signup activo (form de signup pre-seleccionado)", () => {
    setup({ initialMode: "signup" });

    // Form de signup renderizado al mount (sin click intermedio): campo
    // "Tu nombre" + texto de términos + botón "Crear mi cuenta" visibles.
    expect(screen.getByLabelText("Tu nombre")).toBeInTheDocument();
    expect(screen.getByText(/Acepto los/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Crear mi cuenta" }),
    ).toBeInTheDocument();

    // El botón del tab "Crear cuenta" tiene aria-pressed=true (activo); el
    // de "Iniciar sesión" tiene aria-pressed=false. Asegura que el state
    // del hook está alineado con lo que el user ve.
    const signupTab = screen.getByRole("button", { name: "Crear cuenta" });
    const loginTab = screen.getByRole("button", { name: "Iniciar sesión" });
    expect(signupTab.getAttribute("aria-pressed")).toBe("true");
    expect(loginTab.getAttribute("aria-pressed")).toBe("false");
  });

  // ADR-0046 §D2 + §D3 (V1.2 Sesión B): cuando `/login` apex recibe
  // `?invite={token}` válido, la page resuelve `placeSlug` + `placeName`
  // + `postCredentialUrl` server-side (vía `lookupInvitationPreview`) y
  // pasa `inviteContext` al `<AccessFlow>`. El componente reemplaza el
  // header por branding del place inviting + esconde el toggle login/
  // signup (el invitee llegó vía CTA específica, no necesita switchear)
  // + redirige post-success al `postCredentialUrl` en vez del Hub default
  // o el `returnTo` de allowlist. Sin `inviteContext` → V1 path intacto
  // (covered en regression tests arriba).
  describe("ADR-0046 V1.2 Sesión B — inviteContext branding + toggle hide", () => {
    const INVITE_CTX = {
      placeSlug: "nocode-company",
      placeName: "Nocode Company",
      postCredentialUrl:
        "https://nocode-company.place.community/invite/abc123",
    };

    it("renderiza header branding 'Te invitan a unirte a {placeName}' interpolando placeName (no el title default)", () => {
      setup({ inviteContext: INVITE_CTX });
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "Te invitan a unirte a Nocode Company",
        }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Acceso" })).not.toBeInTheDocument();
    });

    it("renderiza subtitle invite-specific (no el subtitle default)", () => {
      setup({ inviteContext: INVITE_CTX });
      expect(
        screen.getByText(
          "Entrá a tu cuenta o creá una nueva para aceptar la invitación.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText("Entrá o creá tu cuenta")).not.toBeInTheDocument();
    });

    it("esconde el toggle login/signup (group ausente) — el invitee no decide tab post-mount", () => {
      setup({ inviteContext: INVITE_CTX });
      expect(screen.queryByRole("group")).not.toBeInTheDocument();
    });

    it("renderiza inviteAcceptHint cerca del submit — explica el siguiente paso del flow", () => {
      setup({ inviteContext: INVITE_CTX });
      expect(
        screen.getByText("Después te llevamos a aceptar la invitación."),
      ).toBeInTheDocument();
    });

    it("login exitoso con inviteContext → navega al postCredentialUrl (NO al Hub ni al returnTo)", async () => {
      const user = userEvent.setup();
      const { navigate } = setup({
        inviteContext: INVITE_CTX,
        // returnTo igual no debe ganar: postCredentialUrl tiene prioridad
        // cuando inviteContext está presente.
        returnTo:
          "https://place.community/api/auth/sso-issue?aud=otro.co&state=x&nonce=y",
      });
      await login(user);

      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith(
          "https://nocode-company.place.community/invite/abc123",
        ),
      );
      expect(navigate).not.toHaveBeenCalledWith(
        "https://app.place.community/es/",
      );
      expect(navigate).not.toHaveBeenCalledWith(
        expect.stringContaining("sso-issue"),
      );
      expect(navigate).toHaveBeenCalledTimes(1);
    });

    it("signup exitoso con inviteContext → navega al postCredentialUrl", async () => {
      const user = userEvent.setup();
      // initialMode='signup' simula el CTA "Crear cuenta" del invite (la
      // page apex propaga ?mode=signup + ?invite= juntos).
      const { navigate } = setup({
        inviteContext: INVITE_CTX,
        initialMode: "signup",
      });
      await user.type(screen.getByLabelText("Tu nombre"), "Ana");
      await user.type(screen.getByLabelText("Email"), "ana@ejemplo.com");
      await user.type(screen.getByLabelText("Contraseña"), "supersegura");
      await user.click(screen.getByLabelText(/Acepto los/));
      await user.click(screen.getByRole("button", { name: "Crear mi cuenta" }));

      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith(
          "https://nocode-company.place.community/invite/abc123",
        ),
      );
    });

    it("regression: sin inviteContext → V1 path intacto (header default, toggle visible, navega al Hub/returnTo)", async () => {
      const user = userEvent.setup();
      const { navigate } = setup();
      // Header default visible.
      expect(
        screen.getByRole("heading", { level: 1, name: "Acceso" }),
      ).toBeInTheDocument();
      // Toggle visible.
      expect(screen.getByRole("group")).toBeInTheDocument();
      // inviteAcceptHint NO renderizado.
      expect(
        screen.queryByText("Después te llevamos a aceptar la invitación."),
      ).not.toBeInTheDocument();
      // Post-auth: Hub default.
      await login(user);
      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith("https://app.place.community/es/"),
      );
    });
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
