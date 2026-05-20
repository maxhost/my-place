import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InboxPayload, InboxPlace } from "../domain/inbox-payload";
import type { InboxLabels } from "../ui/inbox-labels";
import { PlacesView } from "../ui/places-view";

// Tests de la vista principal del Hub (S4 del Hub V1, `docs/features/inbox/spec.md`
// §"Lista de places" + §"Estado vacío"). Componente puro: recibe el `payload`
// ya resuelto por el page del Hub (S5 va a invocar `getInboxPayload(executor)`
// y le pasa el resultado).
//
// Patrón seam-split del repo: NO mockeamos el wrapper de la query (`vi.mock`
// de módulos es frágil); el componente recibe el payload como prop directo —
// la integración con la DB la testea `src/db/__tests__/get-inbox-payload.test.ts`
// + el smoke del page en S5.
//
// Responsabilidades del componente:
// - Si `payload.places` está vacío → `<EmptyState />`.
// - Si hay places → un `<PlaceCard />` por cada lugar.
// - Heading `<h1>` con el `viewTitle` para semantic structure del main.
// - El orden lo dicta la stored function (owner-first + alfabético dentro,
//   spec §"Orden V1"); este componente NO re-ordena.

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

const ACUARIO: InboxPlace = {
  id: "p1",
  slug: "acuario",
  name: "Acuario",
  themeAccent: "#aabbcc",
  status: "ACTIVE",
  isOwner: true,
  memberSince: new Date("2024-01-10T10:00:00Z"),
};
const BOSQUE: InboxPlace = {
  id: "p2",
  slug: "bosque",
  name: "Bosque",
  themeAccent: "#bbccdd",
  status: "ACTIVE",
  isOwner: true,
  memberSince: new Date("2024-02-15T10:00:00Z"),
};
const YOGA: InboxPlace = {
  id: "p3",
  slug: "yoga",
  name: "Yoga",
  themeAccent: "#ccddee",
  status: "ACTIVE",
  isOwner: false,
  memberSince: new Date("2024-04-20T10:00:00Z"),
};

describe("PlacesView — vista 'Tus lugares' del Hub", () => {
  it("renderea heading con el viewTitle + 1 PlaceCard por lugar en el orden del payload", () => {
    const payload: InboxPayload = {
      displayName: "Ana",
      places: [ACUARIO, BOSQUE, YOGA],
    };
    render(<PlacesView payload={payload} labels={LABELS} locale="es" />);
    // Heading
    expect(
      screen.getByRole("heading", { level: 1, name: "Tus lugares" }),
    ).toBeInTheDocument();
    // 3 cards (cada uno con su nombre)
    expect(screen.getByText("Acuario")).toBeInTheDocument();
    expect(screen.getByText("Bosque")).toBeInTheDocument();
    expect(screen.getByText("Yoga")).toBeInTheDocument();
    // Orden: la stored function devuelve owner-first + alfabético — el
    // componente respeta el orden del array (NO reordena).
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent("Acuario");
    expect(cards[1]).toHaveTextContent("Bosque");
    expect(cards[2]).toHaveTextContent("Yoga");
  });

  it("payload sin places → renderea EmptyState, no cards", () => {
    const payload: InboxPayload = { displayName: "Ana", places: [] };
    render(<PlacesView payload={payload} labels={LABELS} locale="es" />);
    // Heading sigue presente (semantic structure del main, no depende del
    // estado vacío).
    expect(
      screen.getByRole("heading", { level: 1, name: "Tus lugares" }),
    ).toBeInTheDocument();
    // EmptyState
    expect(
      screen.getByText("Todavía no tenés ningún lugar."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crear un lugar" })).toBeInTheDocument();
    // Cero cards
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });

  it("place no-ACTIVE → card con badge visible (Pago pendiente)", () => {
    const pending: InboxPlace = { ...ACUARIO, status: "PAYMENT_PENDING" };
    const payload: InboxPayload = { displayName: "Ana", places: [pending] };
    render(<PlacesView payload={payload} labels={LABELS} locale="es" />);
    expect(screen.getByText("Pago pendiente")).toBeInTheDocument();
    // El card no tiene botones de acción (matriz spec §G4)
    expect(screen.queryByRole("link", { name: "Entrar" })).not.toBeInTheDocument();
  });
});
