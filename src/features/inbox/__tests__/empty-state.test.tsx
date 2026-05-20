import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "../ui/empty-state";
import type { InboxLabels } from "../ui/inbox-labels";

// Tests del estado vacío del Hub (S4 del Hub V1, spec §"Estado vacío"). User
// recién creado o sin places activos ve este componente con 2 CTAs:
//
//   1. "Crear un lugar" — link a /{locale}/crear?from=hub. El `?from=hub` le
//      avisa al wizard que el user ya está autenticado (S5 lo cablea), para
//      que muestre el wizard authed directo sin pasar por el paso "cuenta".
//   2. "Sumarme a un lugar" — V1 disabled con tooltip "Próximamente". El
//      flujo de invitaciones por link (features/README:75) entra en Roadmap.

const LABELS: InboxLabels = {
  viewTitle: "Tus lugares",
  cardEnter: "Entrar",
  cardSettings: "Configurar",
  cardMemberSince: "Miembro desde {date}",
  statusPaymentPending: "Pago pendiente",
  statusInactivationProcess: "En recuperación",
  statusInactive: "Cerrado",
  emptyTitle: "Todavía no tenés ningún lugar.",
  emptyBody: "Podés crear el tuyo o sumarte a uno con una invitación.",
  emptyCreateAction: "Crear un lugar",
  emptyJoinAction: "Sumarme a un lugar",
  emptyJoinComingSoon: "Próximamente",
};

describe("EmptyState — vista del hub cuando el user no tiene places", () => {
  it("renderea título + cuerpo + 2 CTAs con sus textos", () => {
    render(<EmptyState labels={LABELS} locale="es" />);
    expect(
      screen.getByText("Todavía no tenés ningún lugar."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Podés crear el tuyo o sumarte a uno con una invitación.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Crear un lugar")).toBeInTheDocument();
    expect(screen.getByText("Sumarme a un lugar")).toBeInTheDocument();
  });

  it("CTA 'Crear un lugar' es un link absoluto al apex (cross-subdomain)", () => {
    // El user está en app.place.community/{locale}/ — /crear vive sólo en
    // (marketing) del apex. Por eso el href es absoluto, construido con
    // `rootDomain()` (fallback en tests = "place.community").
    render(<EmptyState labels={LABELS} locale="es" />);
    const create = screen.getByRole("link", { name: "Crear un lugar" });
    expect(create).toHaveAttribute(
      "href",
      "https://place.community/es/crear?from=hub",
    );
  });

  it("CTA 'Sumarme a un lugar' es disabled + tooltip 'Próximamente' (sin link)", () => {
    render(<EmptyState labels={LABELS} locale="es" />);
    // El "Sumarme" NO debe aparecer como link (V1 sin destino).
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("Crear un lugar");

    // El "Sumarme" sí debe estar presente como elemento con aria-disabled+title.
    const join = screen.getByText("Sumarme a un lugar").closest("[aria-disabled]");
    expect(join).toHaveAttribute("aria-disabled", "true");
    expect(join).toHaveAttribute("title", "Próximamente");
  });

  it("usa el locale dinámicamente en el href de 'Crear un lugar'", () => {
    render(<EmptyState labels={LABELS} locale="en" />);
    const create = screen.getByRole("link", { name: "Crear un lugar" });
    expect(create).toHaveAttribute(
      "href",
      "https://place.community/en/crear?from=hub",
    );
  });
});
