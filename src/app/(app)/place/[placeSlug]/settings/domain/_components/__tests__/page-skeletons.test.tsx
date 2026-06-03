import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DomainSkeleton } from "../page-skeletons";

// Tests RTL del `<DomainSkeleton />` (Phase 2.H.1). Fallback del `<Suspense>`
// del page `/settings/domain` (el await más lento de los settings: lazy poll
// + Vercel). Presentacional puro → verifica el contrato de a11y (status
// region anunciable) + la silueta de la tabla DNS.

describe("DomainSkeleton", () => {
  it("expone una región status anunciable mientras carga", () => {
    render(<DomainSkeleton />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveAccessibleName("Cargando dominio");
  });

  it("renderiza la silueta de 3 filas DNS", () => {
    const { container } = render(<DomainSkeleton />);

    // Las filas DNS son los bloques `h-9` del placeholder de tabla.
    const dnsRows = container.querySelectorAll("span.h-9");
    expect(dnsRows).toHaveLength(3);
  });
});
