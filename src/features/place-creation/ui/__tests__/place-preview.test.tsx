import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PAPEL_PALETTE } from "../../domain/defaults";
import { PlacePreview } from "../place-preview";

// Guardrail de contraste en el preview (ADR-0005 §7/§8). El aviso calmo
// dispara SOLO ante un ajuste del token PERSISTIDO `ink` (lo que el owner
// eligió); `accentStrong` es un derivado de render que NO se persiste y
// existe siempre, incluso para la paleta de marca Papel → avisarlo sería
// ruido alarmista (cozytech). Las paletas preset que ofrece el wizard son
// AA-limpias por diseño (no se envían defaults rotos); este guardrail es
// defensa en profundidad para S10 (paleta propuesta por LLM) y futuros
// pickers libres. Acá se prueba la mecánica directamente.

const LABELS = {
  previewLabel: "Así se va a ver",
  previewEmptyName: "Tu lugar",
  guardrailNotice: "Ajustamos un color para que se lea bien",
};

describe("PlacePreview — guardrail de contraste", () => {
  it("con Papel (AA) NO muestra aviso (accentStrong no se avisa)", () => {
    render(
      <PlacePreview name="Mi Club" palette={PAPEL_PALETTE} labels={LABELS} />,
    );
    expect(
      screen.queryByTestId("preview-guardrail-notice"),
    ).not.toBeInTheDocument();
  });

  it("avisa (calmo) cuando el `ink` elegido no contrasta sobre `bg`", () => {
    render(
      <PlacePreview
        name="Mi Club"
        // ink gris claro sobre crema → < 4.5:1 → el guardrail ajusta `ink`.
        palette={{ accent: "#c4632f", bg: "#faf7f0", ink: "#bbbbbb" }}
        labels={LABELS}
      />,
    );
    expect(
      screen.getByTestId("preview-guardrail-notice"),
    ).toHaveTextContent("Ajustamos un color para que se lea bien");
  });

  it("nunca pinta texto sobre `bg` sin corregir: el preview siempre se ve", () => {
    render(
      <PlacePreview
        name="Mi Club"
        palette={{ accent: "#c4632f", bg: "#faf7f0", ink: "#bbbbbb" }}
        labels={LABELS}
      />,
    );
    expect(screen.getByText("Mi Club")).toBeInTheDocument();
  });
});
