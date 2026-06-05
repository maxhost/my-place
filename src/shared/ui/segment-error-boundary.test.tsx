// Mock `@sentry/nextjs` antes de importar el módulo bajo test: el primitive
// importa el SDK at module-eval, el mock tiene que estar registrado primero
// para que la import-resolution use el stub en vez de la lib real (mismo
// patrón que `observability/__tests__/log.test.ts`).
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";

import { SegmentErrorBoundary } from "./segment-error-boundary";

// Tests del error boundary per-segment (Phase 2.H.2). Contrato:
//   - Anuncia el fallo (`role="alert"`) con copy ES hardcodeado (sin i18n
//     client en el repo, ADR-0024).
//   - El CTA "Reintentar" llama `reset()` (recovery del boundary Next).
//   - Reporta a Sentry vía `useEffect` al montar (ADR-0047).

describe("SegmentErrorBoundary", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("anuncia el fallo con copy en español", () => {
    render(<SegmentErrorBoundary error={new Error("boom")} reset={vi.fn()} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Algo salió mal");
    expect(alert).toHaveTextContent(
      "Tuvimos un problema cargando esta sección. Ya estamos al tanto.",
    );
  });

  it("el CTA Reintentar llama reset()", () => {
    const reset = vi.fn();
    render(<SegmentErrorBoundary error={new Error("boom")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("reporta el error a Sentry al montar", () => {
    const error = new Error("boom");
    render(<SegmentErrorBoundary error={error} reset={vi.fn()} />);

    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });
});
