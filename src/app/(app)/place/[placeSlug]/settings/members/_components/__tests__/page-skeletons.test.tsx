import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MembersSkeleton } from "../page-skeletons";

// Tests RTL del `<MembersSkeleton />` (Phase 2.H.1). El skeleton es el
// fallback del `<Suspense>` del page `/settings/members`: presentacional
// puro → testeable directo (a diferencia del page RSC que cruza next/headers
// + Neon). Verifica el contrato de a11y (status region anunciable) + que la
// cantidad de filas placeholder respeta el prop `rows`.

describe("MembersSkeleton", () => {
  it("expone una región status anunciable mientras carga", () => {
    render(<MembersSkeleton />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveAccessibleName("Cargando miembros");
  });

  it("renderiza la cantidad de filas placeholder del prop `rows`", () => {
    const { container } = render(<MembersSkeleton rows={6} />);

    // Cada fila tiene un avatar circular (`rounded-full`) — proxy contable
    // de la cantidad de filas.
    const avatars = container.querySelectorAll("span.rounded-full");
    expect(avatars).toHaveLength(6);
  });

  it("usa 4 filas por default", () => {
    const { container } = render(<MembersSkeleton />);

    const avatars = container.querySelectorAll("span.rounded-full");
    expect(avatars).toHaveLength(4);
  });
});
