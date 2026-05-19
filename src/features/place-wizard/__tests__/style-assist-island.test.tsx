import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StyleSuggestionResult } from "@/features/style-assist/public";
import {
  PlaceWizard,
  type WizardLabels,
  type WizardSuggest,
} from "../place-wizard";

// Tests de la isla de asistencia propose-only en el Paso 2 (S10b, ADR-0005
// §5/§6 / ADR-0007). jsdom + RTL. Seam-split: el Server Action vivo
// (`suggestStyleAction` del slice `style-assist`) se cablea en la ruta; acá
// se inyecta un fake `onSuggest` (mismo patrón que `onSubmit`, S8b/S5b).
// Invariante de producto: NADA se auto-aplica — el owner aplica cada parte;
// `unavailable`/falla degrada sin bloquear; sin horario en la UI.

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
  accountFailedNotice: "No pudimos crear la cuenta. Quizás ya tengas una.",
  assistButton: "Sugerir un punto de partida",
  assistLoading: "Pensando una propuesta…",
  assistNeedDescription:
    "Contanos arriba para quién es tu lugar y te proponemos un punto de partida",
  assistUnavailable:
    "No pudimos sugerir ahora. Seguí eligiendo a mano, sin apuro.",
  assistProposedTitle: "Una propuesta para empezar",
  assistProposedHint:
    "Es solo un punto de partida. Aplicá lo que te guste; el resto, a mano.",
  assistPaletteLabel: "Colores propuestos",
  assistDescriptionLabel: "Texto propuesto",
  assistApplyPalette: "Usar estos colores",
  assistApplyDescription: "Usar este texto",
  assistApplied: "Aplicado",
  paletteModeLabel: "¿Cómo elegís los colores?",
  paletteModePreset: "Predefinidas",
  paletteModeCustom: "Personalizado",
  paletteCustomTitle: "Tus colores",
  paletteCustomAccentLabel: "Color principal",
  paletteCustomBgLabel: "Fondo",
  paletteCustomInkLabel: "Texto",
  paletteCustomHexInvalid: "Hex inválido (#rrggbb).",
  paletteCustomPickerSuffix: "(selector de color)",
};

const SUGGESTION: StyleSuggestionResult = {
  status: "suggested",
  palette: { accent: "#3344ff", bg: "#fbfbf7", ink: "#1a1a1a" },
  accentStrong: "#2233cc",
  adjustments: [],
  descriptionDraft: "Un rincón tranquilo para leer y conversar sin apuro.",
};

function setup(onSuggest?: WizardSuggest) {
  const utils = render(
    <PlaceWizard
      labels={LABELS}
      rootDomain="place.community"
      termsHref="/es/terminos"
      privacyHref="/es/privacidad"
      onSubmit={vi.fn(async () => ({
        status: "created" as const,
        placeId: "p1",
        slug: "mi-club",
        adjustments: [],
      }))}
      onSuggest={onSuggest}
    />,
  );
  return { ...utils, onSuggest };
}

// Paso 1 → Paso 2 (Estilo), donde vive la isla.
async function gotoStyleStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nombre del lugar"), "Mi Club");
  await user.clear(screen.getByLabelText("Dirección"));
  await user.type(screen.getByLabelText("Dirección"), "mi-club");
  await user.click(screen.getByRole("button", { name: "Siguiente" }));
}

describe("S10b — isla propose-only", () => {
  it("no se renderiza si la ruta no cablea la asistencia (opcional)", async () => {
    const user = userEvent.setup();
    setup(undefined);
    await gotoStyleStep(user);
    expect(
      screen.queryByRole("button", { name: "Sugerir un punto de partida" }),
    ).not.toBeInTheDocument();
  });

  it("el botón está en pausa sin descripción y se habilita al escribirla", async () => {
    const user = userEvent.setup();
    setup(vi.fn<WizardSuggest>(async () => SUGGESTION));
    await gotoStyleStep(user);

    const btn = screen.getByRole("button", {
      name: "Sugerir un punto de partida",
    });
    expect(btn).toBeDisabled();
    expect(
      screen.getByText(
        "Contanos arriba para quién es tu lugar y te proponemos un punto de partida",
      ),
    ).toBeInTheDocument();

    await user.type(
      screen.getByLabelText("Descripción"),
      "Un club de lectura barrial",
    );
    expect(btn).toBeEnabled();
  });

  it("propone sin auto-aplicar: el preview no cambia hasta que el owner aplica", async () => {
    const user = userEvent.setup();
    const onSuggest = vi.fn<WizardSuggest>(async () => SUGGESTION);
    setup(onSuggest);
    await gotoStyleStep(user);
    await user.type(
      screen.getByLabelText("Descripción"),
      "Un club de lectura barrial",
    );

    const preview = screen.getByTestId("place-preview");
    const before = preview.getAttribute("style");

    await user.click(
      screen.getByRole("button", { name: "Sugerir un punto de partida" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Una propuesta para empezar")).toBeInTheDocument(),
    );
    expect(onSuggest).toHaveBeenCalledWith("Un club de lectura barrial");
    // Propuesta visible, pero NADA aplicado todavía (propose-only).
    expect(
      screen.getByText(SUGGESTION.descriptionDraft),
    ).toBeInTheDocument();
    expect(preview.getAttribute("style")).toBe(before);
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Descripción").value,
    ).toBe("Un club de lectura barrial");
  });

  it("aplicar la paleta cambia el preview; el texto NO se toca", async () => {
    const user = userEvent.setup();
    setup(vi.fn<WizardSuggest>(async () => SUGGESTION));
    await gotoStyleStep(user);
    await user.type(screen.getByLabelText("Descripción"), "Algo cálido");
    await user.click(
      screen.getByRole("button", { name: "Sugerir un punto de partida" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Una propuesta para empezar")).toBeInTheDocument(),
    );

    const preview = screen.getByTestId("place-preview");
    // jsdom serializa el hex a rgb: #fbfbf7 → rgb(251, 251, 247).
    await user.click(screen.getByRole("button", { name: "Usar estos colores" }));
    await waitFor(() =>
      expect(preview.getAttribute("style") ?? "").toContain(
        "rgb(251, 251, 247)",
      ),
    );
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Descripción").value,
    ).toBe("Algo cálido");
  });

  it("aplicar el texto rellena la descripción; la paleta NO se toca", async () => {
    const user = userEvent.setup();
    setup(vi.fn<WizardSuggest>(async () => SUGGESTION));
    await gotoStyleStep(user);
    await user.type(screen.getByLabelText("Descripción"), "Algo cálido");
    await user.click(
      screen.getByRole("button", { name: "Sugerir un punto de partida" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Una propuesta para empezar")).toBeInTheDocument(),
    );

    const preview = screen.getByTestId("place-preview");
    const before = preview.getAttribute("style");
    await user.click(screen.getByRole("button", { name: "Usar este texto" }));
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Descripción").value,
    ).toBe(SUGGESTION.descriptionDraft);
    expect(preview.getAttribute("style")).toBe(before);
  });

  it("elegir un preset después de aplicar la paleta sugerida vuelve al preset", async () => {
    const user = userEvent.setup();
    setup(vi.fn<WizardSuggest>(async () => SUGGESTION));
    await gotoStyleStep(user);
    await user.type(screen.getByLabelText("Descripción"), "Algo cálido");
    await user.click(
      screen.getByRole("button", { name: "Sugerir un punto de partida" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Una propuesta para empezar")).toBeInTheDocument(),
    );
    const preview = screen.getByTestId("place-preview");
    await user.click(screen.getByRole("button", { name: "Usar estos colores" }));
    await waitFor(() =>
      expect(preview.getAttribute("style") ?? "").toContain(
        "rgb(251, 251, 247)",
      ),
    );

    // Tras aplicar la propuesta del LLM, el wizard queda en modo
    // "Personalizado" (consecuencia del derivado: customPalette no-null).
    // Volver a un preset es explícito (cozytech `producto.md` §30): primero
    // se elige "Predefinidas", después el preset.
    await user.click(screen.getByRole("radio", { name: "Predefinidas" }));
    const bosque = screen.getByRole("radio", { name: "Bosque" });
    await user.click(bosque);
    expect(bosque).toBeChecked();
    expect(preview.getAttribute("style") ?? "").not.toContain(
      "rgb(251, 251, 247)",
    );
  });

  it("`unavailable` degrada sin bloquear: aviso calmo y se sigue a mano", async () => {
    const user = userEvent.setup();
    setup(vi.fn<WizardSuggest>(async () => ({ status: "unavailable" })));
    await gotoStyleStep(user);
    await user.type(screen.getByLabelText("Descripción"), "Algo cálido");
    await user.click(
      screen.getByRole("button", { name: "Sugerir un punto de partida" }),
    );

    await waitFor(() =>
      expect(
        screen.getByText(
          "No pudimos sugerir ahora. Seguí eligiendo a mano, sin apuro.",
        ),
      ).toBeInTheDocument(),
    );
    // No bloquea: el Paso 2 sigue siendo válido y se puede avanzar.
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeEnabled();
  });

  it("si el action lanza, también degrada a aviso calmo (sin crash)", async () => {
    const user = userEvent.setup();
    setup(
      vi.fn<WizardSuggest>(async () => {
        throw new Error("network");
      }),
    );
    await gotoStyleStep(user);
    await user.type(screen.getByLabelText("Descripción"), "Algo cálido");
    await user.click(
      screen.getByRole("button", { name: "Sugerir un punto de partida" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          "No pudimos sugerir ahora. Seguí eligiendo a mano, sin apuro.",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("muestra el aviso del guardrail si la propuesta ajustó un color", async () => {
    const user = userEvent.setup();
    setup(
      vi.fn<WizardSuggest>(async () => ({
        ...SUGGESTION,
        adjustments: [
          {
            token: "ink",
            from: "#777777",
            to: "#1a1a1a",
            ratioBefore: 3.1,
            ratioAfter: 12.4,
          },
        ],
      })),
    );
    await gotoStyleStep(user);
    await user.type(screen.getByLabelText("Descripción"), "Algo cálido");
    await user.click(
      screen.getByRole("button", { name: "Sugerir un punto de partida" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("Ajustamos un color para que se lea bien"),
      ).toBeInTheDocument(),
    );
  });
});
