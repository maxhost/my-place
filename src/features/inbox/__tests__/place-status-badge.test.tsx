import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InboxLabels } from "../ui/inbox-labels";
import { PlaceStatusBadge } from "../ui/place-status-badge";

// Tests del badge de status del place (S4 del Hub V1, spec §"Badges + acciones
// por estado"). ACTIVE NO renderea nada (es el caso esperado, no necesita
// marca); los 3 estados restantes pintan un badge con el token de color
// correspondiente del producto:
//
//   PAYMENT_PENDING       → bg-warn   (cálido)  "Pago pendiente"
//   INACTIVATION_PROCESS  → bg-info   (frío)    "En recuperación"
//   INACTIVE              → bg-muted  (neutro)  "Cerrado"
//
// El badge es presentacional puro (sin estado, sin handlers). El page del
// Hub no necesita lógica extra — el componente decide cómo presentarse en
// base al status.

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

describe("PlaceStatusBadge — pinta el status del place sólo si no es ACTIVE", () => {
  it("status ACTIVE → no renderea nada (sin marca para el caso esperado)", () => {
    const { container } = render(
      <PlaceStatusBadge status="ACTIVE" labels={LABELS} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("status PAYMENT_PENDING → label 'Pago pendiente' + token bg-warn", () => {
    const { container } = render(
      <PlaceStatusBadge status="PAYMENT_PENDING" labels={LABELS} />,
    );
    expect(screen.getByText("Pago pendiente")).toBeInTheDocument();
    const badge = container.firstChild as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.className).toContain("bg-warn");
  });

  it("status INACTIVATION_PROCESS → label 'En recuperación' + token bg-info", () => {
    const { container } = render(
      <PlaceStatusBadge status="INACTIVATION_PROCESS" labels={LABELS} />,
    );
    expect(screen.getByText("En recuperación")).toBeInTheDocument();
    const badge = container.firstChild as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.className).toContain("bg-info");
  });

  it("status INACTIVE → label 'Cerrado' + token bg-muted", () => {
    const { container } = render(
      <PlaceStatusBadge status="INACTIVE" labels={LABELS} />,
    );
    expect(screen.getByText("Cerrado")).toBeInTheDocument();
    const badge = container.firstChild as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.className).toContain("bg-muted");
  });
});
