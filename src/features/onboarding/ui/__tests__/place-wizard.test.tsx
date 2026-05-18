import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PlaceWizard, type WizardLabels } from "../place-wizard";

// Tests de componente del wizard place-first (S8a): shell + Paso 1 + preview
// en vivo. jsdom + RTL. El wizard recibe sus textos por prop `labels`
// (serializable, sin runtime i18n en cliente → testeable sin provider; el
// Server Component de la ruta los traducirá en S8b).

const LABELS: WizardLabels = {
  title: "Creá tu lugar",
  progress: "Paso {n} de {total}",
  stepTitles: ["Identidad"],
  next: "Siguiente",
  back: "Atrás",
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
};

function setup() {
  return render(<PlaceWizard labels={LABELS} rootDomain="place.community" />);
}

describe("PlaceWizard — shell + Paso 1", () => {
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
    // Tras editar el slug a mano, deja de seguir al nombre.
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
      screen.getByText(
        "La disponibilidad final se confirma al crear el lugar",
      ),
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

  it("con la paleta Papel (AA) el preview no muestra aviso de guardrail", () => {
    setup();
    expect(
      screen.queryByTestId("preview-guardrail-notice"),
    ).not.toBeInTheDocument();
  });

  it("'Siguiente' está deshabilitado mientras el Paso 1 es inválido", async () => {
    const user = userEvent.setup();
    setup();
    const next = screen.getByRole("button", { name: "Siguiente" });
    expect(next).toBeDisabled();

    // Nombre ok pero sin slug válido → sigue deshabilitado.
    await user.type(screen.getByLabelText("Nombre del lugar"), "Hola");
    await user.clear(screen.getByLabelText("Dirección"));
    await user.type(screen.getByLabelText("Dirección"), "ab");
    expect(next).toBeDisabled();
  });
});
