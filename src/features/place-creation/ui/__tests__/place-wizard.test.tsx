import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CreatePlaceResult } from "../../create-place";
import {
  PlaceWizard,
  type WizardLabels,
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
  descriptionLabel: "Descripción",
  descriptionPlaceholder: "Una línea sobre tu lugar",
  descriptionHint: "Opcional. Hasta 500 caracteres.",
  descriptionTooLong: "La descripción es demasiado larga",
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
  assistButton: "Sugerir un punto de partida",
  assistLoading: "Pensando una propuesta…",
  assistNeedDescription: "Contanos arriba para quién es tu lugar",
  assistUnavailable: "No pudimos sugerir ahora. Seguí a mano, sin apuro.",
  assistProposedTitle: "Una propuesta para empezar",
  assistProposedHint: "Es solo un punto de partida.",
  assistPaletteLabel: "Colores propuestos",
  assistDescriptionLabel: "Texto propuesto",
  assistApplyPalette: "Usar estos colores",
  assistApplyDescription: "Usar este texto",
  assistApplied: "Aplicado",
};

function setup(
  onSubmit: WizardSubmit = vi.fn<WizardSubmit>(async () => ({
    status: "created",
    placeId: "p1",
    slug: "mi-club",
    adjustments: [],
  })),
) {
  const utils = render(
    <PlaceWizard
      labels={LABELS}
      rootDomain="place.community"
      termsHref="/es/terminos"
      privacyHref="/es/privacidad"
      onSubmit={onSubmit}
    />,
  );
  return { ...utils, onSubmit };
}

// Recorre Paso 1 → Paso 2 → Paso 3 con datos válidos.
async function fillToAccountStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nombre del lugar"), "Mi Club");
  await user.clear(screen.getByLabelText("Dirección"));
  await user.type(screen.getByLabelText("Dirección"), "mi-club");
  await user.click(screen.getByRole("button", { name: "Siguiente" }));

  await user.type(
    screen.getByLabelText("Descripción"),
    "Un lugar tranquilo para leer juntos",
  );
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
    expect(screen.getByLabelText("Descripción")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Atrás" }));
    expect(screen.getByText("Paso 1 de 3")).toBeInTheDocument();
    expect(
      screen.getByLabelText<HTMLInputElement>("Dirección").value,
    ).toBe("mi-club");
  });

  it("bloquea avanzar si la descripción excede 500 caracteres", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText("Nombre del lugar"), "Mi Club");
    await user.clear(screen.getByLabelText("Dirección"));
    await user.type(screen.getByLabelText("Dirección"), "mi-club");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    const desc = screen.getByLabelText("Descripción");
    await user.click(desc);
    await user.paste("x".repeat(501));
    expect(
      screen.getByText("La descripción es demasiado larga"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
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
});

describe("PlaceWizard — Paso 3 (cuenta) + submit", () => {
  it("crea el lugar y muestra la pantalla de éxito con la URL", async () => {
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

    await waitFor(() =>
      expect(screen.getByText("Tu lugar está listo")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Ya podés entrar en mi-club.place.community."),
    ).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [input, credentials] = onSubmit.mock.calls[0];
    expect(input).toMatchObject({ name: "Mi Club", slug: "mi-club" });
    expect(input.ownerTimezone).toBeTruthy();
    expect(credentials).toEqual({
      email: "vos@ejemplo.com",
      password: "supersegura",
      displayName: "Ana",
    });
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
    const [input, credentials] = onSubmit.mock.calls[0];
    expect(input).toMatchObject({ name: "Mi Club", slug: "mi-club" });
    expect(credentials).toBeUndefined();
  });
});
