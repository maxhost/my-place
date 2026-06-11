import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CreatePlaceResult } from "@/features/place-creation/public";
import type { Locale } from "@/i18n/routing";
import {
  PlaceWizard,
  type WizardLabels,
  type WizardSignUp,
  type WizardSubmit,
} from "../place-wizard";

// Tests de componente del wizard place-first completo (S8b): shell + Paso 1
// (S8a) + Paso 2 (descripción + paleta) + Paso 3 (cuenta + T&C + tz) + submit
// + estados post-falla. jsdom + RTL. El wizard recibe sus textos por prop
// `labels` (serializable, sin runtime i18n en cliente → testeable sin
// provider) y el submit por prop `onSubmit` (seam-split: el Server Action
// vivo se cablea en la ruta, acá se inyecta un fake — mismo patrón S5b/S8a).

const LABELS: WizardLabels = {
  title: "Creá tu lugar",
  progress: "Paso {n} de {total}",
  stepTitles: ["Identidad", "Estilo", "Tu cuenta"],
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
  paletteLabel: "Colores",
  paletteNames: {
    papel: "Papel",
    bosque: "Bosque",
    tinta: "Tinta",
    arcilla: "Arcilla",
  },
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
  rateLimitedNotice: "Demasiados intentos. Esperá un momento y volvé a probar.",
  accountFailedNotice: "No pudimos crear la cuenta. Quizás ya tengas una.",
  paletteModeLabel: "¿Cómo elegís los colores?",
  paletteModePreset: "Predefinidas",
  paletteModeCustom: "Personalizado",
  paletteCustomTitle: "Tus colores",
  paletteCustomAccentLabel: "Color principal",
  paletteCustomBgLabel: "Fondo",
  paletteCustomInkLabel: "Texto",
  paletteCustomHexInvalid: "Hex inválido (#rrggbb).",
  paletteCustomPickerSuffix: "(selector de color)",
  // S2b.2 (ADR-0022 + ADR-0024): selector de idioma del lugar en el Paso 1.
  // Endonyms (auto-nombres) — idénticos sin importar el chrome del owner.
  defaultLocaleLabel: "¿En qué idioma habla tu lugar?",
  defaultLocaleOptions: {
    es: "Español",
    en: "English",
    fr: "Français",
    pt: "Português",
    de: "Deutsch",
    ca: "Català",
  },
};

function setup(
  onSubmit: WizardSubmit = vi.fn<WizardSubmit>(async () => ({
    status: "created",
    placeId: "p1",
    slug: "mi-club",
    adjustments: [],
  })),
  onCreateAccount: WizardSignUp = vi.fn<WizardSignUp>(async () => ({
    status: "ok",
  })),
  opts: { defaultLocale?: Locale } = {},
) {
  const utils = render(
    <PlaceWizard
      labels={LABELS}
      rootDomain="place.community"
      termsHref="/es/terminos"
      privacyHref="/es/privacidad"
      onSubmit={onSubmit}
      onCreateAccount={onCreateAccount}
      defaultLocale={opts.defaultLocale}
    />,
  );
  return { ...utils, onSubmit, onCreateAccount };
}

// Recorre Paso 1 → Paso 2 → Paso 3 con datos válidos.
async function fillToAccountStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nombre del lugar"), "Mi Club");
  await user.clear(screen.getByLabelText("Dirección"));
  await user.type(screen.getByLabelText("Dirección"), "mi-club");
  await user.click(screen.getByRole("button", { name: "Siguiente" }));
  // Paso 2 (estilo) no requiere input para avanzar — la paleta default basta.
  await user.click(screen.getByRole("button", { name: "Siguiente" }));

  await user.type(screen.getByLabelText("Email"), "vos@ejemplo.com");
  await user.type(screen.getByLabelText("Contraseña"), "supersegura");
  await user.type(screen.getByLabelText("Tu nombre"), "Ana");
  await user.click(screen.getByLabelText(/Acepto los/));
}

describe("PlaceWizard — shell + Paso 1 (S8a)", () => {
  it("muestra el Paso 1 con nombre, dirección y el progreso calmo", () => {
    setup();
    expect(screen.getByLabelText("Nombre del lugar")).toBeInTheDocument();
    expect(screen.getByLabelText("Dirección")).toBeInTheDocument();
    expect(screen.getByText("Paso 1 de 3")).toBeInTheDocument();
  });

  it("auto-deriva el slug del nombre hasta que el usuario lo edita a mano", async () => {
    const user = userEvent.setup();
    setup();
    const name = screen.getByLabelText("Nombre del lugar");
    const slug = screen.getByLabelText<HTMLInputElement>("Dirección");

    await user.type(name, "Mi Club de Lectura");
    expect(slug.value).toBe("mi-club-de-lectura");

    await user.clear(slug);
    await user.type(slug, "circulo");
    await user.clear(name);
    await user.type(name, "Otro Nombre");
    expect(slug.value).toBe("circulo");
  });

  it("avisa (no autoritativo) cuando el slug está reservado", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText("Dirección"), "app");
    expect(screen.getByText("Esa dirección está reservada")).toBeInTheDocument();
  });

  it("avisa cuando el formato del slug es inválido", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText("Dirección"), "ab");
    expect(
      screen.getByText("Solo minúsculas, números y guiones (mín. 3)"),
    ).toBeInTheDocument();
  });

  it("con slug válido muestra la aclaración de chequeo no autoritativo", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText("Dirección"), "mi-club");
    expect(
      screen.getByText("La disponibilidad final se confirma al crear el lugar"),
    ).toBeInTheDocument();
    expect(screen.getByText("mi-club.place.community")).toBeInTheDocument();
  });

  it("el preview refleja el nombre en vivo y su placeholder cuando está vacío", async () => {
    const user = userEvent.setup();
    setup();
    const preview = screen.getByTestId("place-preview");
    expect(preview).toHaveTextContent("Tu lugar");

    await user.type(screen.getByLabelText("Nombre del lugar"), "Casa Común");
    expect(preview).toHaveTextContent("Casa Común");
  });

  it("'Siguiente' está deshabilitado mientras el Paso 1 es inválido", async () => {
    const user = userEvent.setup();
    setup();
    const next = screen.getByRole("button", { name: "Siguiente" });
    expect(next).toBeDisabled();

    await user.type(screen.getByLabelText("Nombre del lugar"), "Hola");
    await user.clear(screen.getByLabelText("Dirección"));
    await user.type(screen.getByLabelText("Dirección"), "ab");
    expect(next).toBeDisabled();
  });
});

describe("PlaceWizard — Paso 2 (estilo) y navegación", () => {
  it("avanza al Paso 2 y permite volver al Paso 1 sin perder datos", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText("Nombre del lugar"), "Mi Club");
    await user.clear(screen.getByLabelText("Dirección"));
    await user.type(screen.getByLabelText("Dirección"), "mi-club");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(screen.getByText("Paso 2 de 3")).toBeInTheDocument();
    // El Paso 2 ya no tiene descripción (ADR-0020); el selector de paleta es
    // su único contenido. Identificamos el paso vía el segmented control.
    expect(
      screen.getByRole("radio", { name: "Predefinidas" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Atrás" }));
    expect(screen.getByText("Paso 1 de 3")).toBeInTheDocument();
    expect(
      screen.getByLabelText<HTMLInputElement>("Dirección").value,
    ).toBe("mi-club");
  });

  it("elegir una paleta cambia el preview en vivo", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText("Nombre del lugar"), "Mi Club");
    await user.clear(screen.getByLabelText("Dirección"));
    await user.type(screen.getByLabelText("Dirección"), "mi-club");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    const bosque = screen.getByRole("radio", { name: "Bosque" });
    await user.click(bosque);
    expect(bosque).toBeChecked();
  });

  // Bug histórico (pre-ADR-0020): el modo `paletteMode` era derivado de
  // `customPalette != null`, por lo que volver a "Predefinidas" obligaba a
  // `setCustomPalette(null)` — y el siguiente viaje a "Personalizado" perdía
  // las ediciones del owner. El fix separa `paletteMode` (useState propio) de
  // `customPalette` (que persiste a través del viaje de modos).
  it("paleta personalizada persiste tras viaje Preset → Custom → Preset → Custom", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText("Nombre del lugar"), "Mi Club");
    await user.clear(screen.getByLabelText("Dirección"));
    await user.type(screen.getByLabelText("Dirección"), "mi-club");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    // 1. Entra a modo Personalizado y edita el accent.
    await user.click(screen.getByRole("radio", { name: "Personalizado" }));
    const accent = screen.getByLabelText<HTMLInputElement>("Color principal");
    await user.clear(accent);
    await user.type(accent, "#abcdef");
    expect(accent.value.toLowerCase()).toBe("#abcdef");

    // 2. Vuelve a Predefinidas (los inputs hex desaparecen del DOM).
    await user.click(screen.getByRole("radio", { name: "Predefinidas" }));
    expect(screen.queryByLabelText("Color principal")).not.toBeInTheDocument();

    // 3. Vuelve a Personalizado: el accent editado debe persistir.
    await user.click(screen.getByRole("radio", { name: "Personalizado" }));
    const accentAgain =
      screen.getByLabelText<HTMLInputElement>("Color principal");
    expect(accentAgain.value.toLowerCase()).toBe("#abcdef");
  });
});

describe("PlaceWizard — Paso 3 (cuenta) + submit", () => {
  it("two-phase: crea la cuenta y LUEGO el place (authed), pantalla de éxito", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<WizardSubmit>(async () => ({
      status: "created",
      placeId: "p1",
      slug: "mi-club",
      adjustments: [],
    }));
    const onCreateAccount = vi.fn<WizardSignUp>(async () => ({ status: "ok" }));
    setup(onSubmit, onCreateAccount);
    await fillToAccountStep(user);
    await user.click(screen.getByRole("button", { name: "Crear mi lugar" }));

    await waitFor(() =>
      expect(screen.getByText("Tu lugar está listo")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Ya podés entrar en mi-club.place.community."),
    ).toBeInTheDocument();
    // FASE 1: la cuenta se crea con las credenciales (request previa).
    expect(onCreateAccount).toHaveBeenCalledTimes(1);
    expect(onCreateAccount.mock.calls[0][0]).toEqual({
      email: "vos@ejemplo.com",
      password: "supersegura",
      displayName: "Ana",
    });
    // FASE 2: el place se crea authed — SOLO el input, sin credenciales.
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]).toHaveLength(1);
    const [input] = onSubmit.mock.calls[0];
    expect(input).toMatchObject({ name: "Mi Club", slug: "mi-club" });
    expect(input.ownerTimezone).toBeTruthy();
  });

  it("place-first: si la cuenta falla, aviso calmo y NO se crea el place", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<WizardSubmit>(async () => ({
      status: "created" as const,
      placeId: "p1",
      slug: "mi-club",
      adjustments: [],
    }));
    const onCreateAccount = vi.fn<WizardSignUp>(async () => ({
      status: "signup_failed",
    }));
    setup(onSubmit, onCreateAccount);
    await fillToAccountStep(user);
    await user.click(screen.getByRole("button", { name: "Crear mi lugar" }));

    await waitFor(() =>
      expect(
        screen.getByText("No pudimos crear la cuenta. Quizás ya tengas una."),
      ).toBeInTheDocument(),
    );
    expect(onCreateAccount).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByText("Tu lugar está listo")).not.toBeInTheDocument();
  });

  it("submit rate-limited: aviso calmo dedicado, sin success panel (S2 hardening)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<WizardSubmit>(async () => ({
      status: "rate_limited" as const,
    }));
    setup(onSubmit);
    await fillToAccountStep(user);
    await user.click(screen.getByRole("button", { name: "Crear mi lugar" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "Demasiados intentos. Esperá un momento y volvé a probar.",
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("Tu lugar está listo")).not.toBeInTheDocument();
  });

  it("paleta personalizada: el hex editado se persiste en input.theme", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<WizardSubmit>(async () => ({
      status: "created",
      placeId: "p1",
      slug: "mi-club",
      adjustments: [],
    }));
    setup(onSubmit);
    // Paso 1
    await user.type(screen.getByLabelText("Nombre del lugar"), "Mi Club");
    await user.clear(screen.getByLabelText("Dirección"));
    await user.type(screen.getByLabelText("Dirección"), "mi-club");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    // Paso 2: cambiar a modo "Personalizado" + editar accent.
    await user.click(screen.getByRole("radio", { name: "Personalizado" }));
    const accent = screen.getByLabelText<HTMLInputElement>("Color principal");
    await user.clear(accent);
    await user.type(accent, "#abcdef");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    // Paso 3
    await user.type(screen.getByLabelText("Email"), "vos@ejemplo.com");
    await user.type(screen.getByLabelText("Contraseña"), "supersegura");
    await user.type(screen.getByLabelText("Tu nombre"), "Ana");
    await user.click(screen.getByLabelText(/Acepto los/));
    await user.click(screen.getByRole("button", { name: "Crear mi lugar" }));

    await waitFor(() =>
      expect(screen.getByText("Tu lugar está listo")).toBeInTheDocument(),
    );
    const [input] = onSubmit.mock.calls[0];
    expect(input.theme).toEqual(
      expect.objectContaining({ accent: "#abcdef" }),
    );
  });

  it("no deja crear sin aceptar los términos", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText("Nombre del lugar"), "Mi Club");
    await user.clear(screen.getByLabelText("Dirección"));
    await user.type(screen.getByLabelText("Dirección"), "mi-club");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await user.type(screen.getByLabelText("Email"), "vos@ejemplo.com");
    await user.type(screen.getByLabelText("Contraseña"), "supersegura");
    await user.type(screen.getByLabelText("Tu nombre"), "Ana");

    expect(
      screen.getByRole("button", { name: "Crear mi lugar" }),
    ).toBeDisabled();
  });

  it("slug ocupado: aviso calmo y vuelve al Paso 1", async () => {
    const user = userEvent.setup();
    setup(vi.fn<WizardSubmit>(async () => ({ status: "slug_taken" })));
    await fillToAccountStep(user);
    await user.click(screen.getByRole("button", { name: "Crear mi lugar" }));

    await waitFor(() =>
      expect(
        screen.getByText("Esa dirección ya tiene dueño, probá con otra"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Paso 1 de 3")).toBeInTheDocument();
  });

  it("payload inválido (red de seguridad): aviso calmo, sin pantalla de éxito", async () => {
    const user = userEvent.setup();
    setup(
      vi.fn<WizardSubmit>(async () => ({
        status: "invalid",
        fields: ["slug"],
        message: "x",
      })),
    );
    await fillToAccountStep(user);
    await user.click(screen.getByRole("button", { name: "Crear mi lugar" }));

    await waitFor(() =>
      expect(
        screen.getByText("Revisá los datos e intentá de nuevo"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("Tu lugar está listo")).not.toBeInTheDocument();
  });

  it("idempotencia: doble click no dispara dos submits", async () => {
    const user = userEvent.setup();
    let resolve!: (r: CreatePlaceResult) => void;
    const onSubmit = vi.fn<WizardSubmit>(
      () => new Promise<CreatePlaceResult>((r) => (resolve = r)),
    );
    setup(onSubmit);
    await fillToAccountStep(user);
    const createBtn = screen.getByRole("button", { name: "Crear mi lugar" });
    await user.click(createBtn);
    await user.click(createBtn);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    resolve({ status: "created", placeId: "p1", slug: "mi-club", adjustments: [] });
    await waitFor(() =>
      expect(screen.getByText("Tu lugar está listo")).toBeInTheDocument(),
    );
  });
});

// Modo authed (S9): la vía "Acceso" reutiliza el wizard SIN el paso de cuenta
// (el usuario ya está autenticado, ADR-0008 §3). Sólo Identidad + Estilo; el
// submit llama `onSubmit(input)` SIN credenciales → `createPlaceAction` rama
// modo authed (sesión vigente, no re-pide cuenta).
describe("PlaceWizard — modo authed (S9, sin paso de cuenta)", () => {
  function setupAuthed(
    onSubmit: WizardSubmit = vi.fn<WizardSubmit>(async () => ({
      status: "created",
      placeId: "p1",
      slug: "mi-club",
      adjustments: [],
    })),
  ) {
    const utils = render(
      <PlaceWizard
        labels={{ ...LABELS, stepTitles: ["Identidad", "Estilo"] }}
        rootDomain="place.community"
        termsHref="/es/terminos"
        privacyHref="/es/privacidad"
        onSubmit={onSubmit}
        authed
      />,
    );
    return { ...utils, onSubmit };
  }

  it("son 2 pasos y nunca pide email/contraseña", async () => {
    const user = userEvent.setup();
    setupAuthed();
    expect(screen.getByText("Paso 1 de 2")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Nombre del lugar"), "Mi Club");
    await user.clear(screen.getByLabelText("Dirección"));
    await user.type(screen.getByLabelText("Dirección"), "mi-club");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(screen.getByText("Paso 2 de 2")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();
  });

  it("crea el lugar llamando onSubmit SIN credenciales", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<WizardSubmit>(async () => ({
      status: "created",
      placeId: "p1",
      slug: "mi-club",
      adjustments: [],
    }));
    setupAuthed(onSubmit);

    await user.type(screen.getByLabelText("Nombre del lugar"), "Mi Club");
    await user.clear(screen.getByLabelText("Dirección"));
    await user.type(screen.getByLabelText("Dirección"), "mi-club");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await user.click(screen.getByRole("button", { name: "Crear mi lugar" }));

    await waitFor(() =>
      expect(screen.getByText("Tu lugar está listo")).toBeInTheDocument(),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // authed: el wizard llama onSubmit SOLO con el input (sin credenciales;
    // la sesión ya existe — el JWT lo resuelve el Server Action authed).
    expect(onSubmit.mock.calls[0]).toHaveLength(1);
    const [input] = onSubmit.mock.calls[0];
    expect(input).toMatchObject({ name: "Mi Club", slug: "mi-club" });
  });
});

// S2b.2 (ADR-0022 + ADR-0024): el selector de idioma del lugar vive en el Paso
// 1 — radiogroup con 6 endonyms (Español/English/Français/Português/Deutsch/
// Català). Arranca en el `defaultLocale` que la ruta cablea desde el path; el
// owner puede cambiarlo antes de avanzar. El cambio viaja al payload del
// `onSubmit` (S2b.1 cerró el plumbing; acá se cierra el UX).
describe("PlaceWizard — selector de idioma del Paso 1 (S2b.2)", () => {
  it("renderea el radiogroup con los 6 endonyms operativos", () => {
    setup();
    expect(
      screen.getByRole("radiogroup", { name: "¿En qué idioma habla tu lugar?" }),
    ).toBeInTheDocument();
    for (const endonym of [
      "Español",
      "English",
      "Français",
      "Português",
      "Deutsch",
      "Català",
    ]) {
      expect(screen.getByRole("radio", { name: endonym })).toBeInTheDocument();
    }
  });

  it("arranca con el endonym del `defaultLocale` cableado (de → Deutsch)", () => {
    setup(undefined, undefined, { defaultLocale: "de" });
    expect(screen.getByRole("radio", { name: "Deutsch" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Español" })).not.toBeChecked();
  });

  it("cambiar el selector propaga el nuevo locale al payload del submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<WizardSubmit>(async () => ({
      status: "created",
      placeId: "p1",
      slug: "mi-club",
      adjustments: [],
    }));
    setup(onSubmit, undefined, { defaultLocale: "es" });

    // Cambiar el idioma del lugar a Català ANTES de avanzar — el selector vive
    // en el Paso 1 junto con nombre + dirección.
    await user.click(screen.getByRole("radio", { name: "Català" }));
    expect(screen.getByRole("radio", { name: "Català" })).toBeChecked();

    await fillToAccountStep(user);
    await user.click(screen.getByRole("button", { name: "Crear mi lugar" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [input] = onSubmit.mock.calls[0];
    expect(input.defaultLocale).toBe("ca");
  });
});

// S2b.1 (ADR-0022 + ADR-0024): el wizard propaga `defaultLocale` desde la prop
// hasta el payload del `onSubmit`. La prop refleja el locale del path (lo
// cablea `crear/page.tsx` en S2b.2); hasta entonces el default 'es' espeja el
// zod (`routing.defaultLocale`) sin regresión. El UI selector visible al owner
// llega en S2b.2 — esta sesión sólo cierra el plumbing interno (state +
// orquestador + prop + assert end-to-end del input).
describe("PlaceWizard — locale del place (S2b.1: plumbing)", () => {
  it("submit incluye defaultLocale='de' cuando la prop lo dice", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<WizardSubmit>(async () => ({
      status: "created",
      placeId: "p1",
      slug: "mi-club",
      adjustments: [],
    }));
    setup(onSubmit, undefined, { defaultLocale: "de" });
    await fillToAccountStep(user);
    await user.click(screen.getByRole("button", { name: "Crear mi lugar" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [input] = onSubmit.mock.calls[0];
    expect(input.defaultLocale).toBe("de");
  });

  it("submit default a 'es' cuando la prop no se pasa (backward-compat)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<WizardSubmit>(async () => ({
      status: "created",
      placeId: "p1",
      slug: "mi-club",
      adjustments: [],
    }));
    setup(onSubmit);
    await fillToAccountStep(user);
    await user.click(screen.getByRole("button", { name: "Crear mi lugar" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [input] = onSubmit.mock.calls[0];
    expect(input.defaultLocale).toBe("es");
  });
});
