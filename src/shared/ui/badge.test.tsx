import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge, type BadgeVariant } from "./badge";

// Tests del Badge shared (Feature E S5, tests.md §S5 Badge). Componente
// presentacional puro con 4 variants — cada variant mapea a un token de
// color del producto. El test bloquea el contract de TS (variant required)
// y el render runtime (clases distintivas + graceful con children vacío).
//
// Mapping variant → token (justificación en el componente):
//   owner   → bg-accent   (CTA-color del place, identidad del dueño)
//   founder → bg-warn     (cálido, distinción del miembro temprano)
//   pending → bg-info     (frío, estado transitorio sin urgencia)
//   expired → bg-muted    (neutro/gris, estado terminado)

// Sanity-check estático del union para que el cambio del tipo rompa el
// test (no para correr lógica). Si BadgeVariant cambia, este array
// también debe.
const ALL_VARIANTS: ReadonlyArray<BadgeVariant> = [
  "owner",
  "founder",
  "pending",
  "expired",
];
void ALL_VARIANTS;

describe("Badge — pinta una píldora con clase distintiva por variant", () => {
  it("variant='owner' + children 'Owner' → texto visible + bg-accent", () => {
    const { container } = render(<Badge variant="owner">Owner</Badge>);
    expect(screen.getByText("Owner")).toBeInTheDocument();
    const badge = container.firstChild as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.className).toContain("bg-accent");
  });

  it("variant='founder' → bg-warn (clase distintiva)", () => {
    const { container } = render(<Badge variant="founder">Founder</Badge>);
    const badge = container.firstChild as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.className).toContain("bg-warn");
  });

  it("variant='pending' → bg-info (clase distintiva)", () => {
    const { container } = render(<Badge variant="pending">Pendiente</Badge>);
    const badge = container.firstChild as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.className).toContain("bg-info");
  });

  it("variant='expired' → bg-muted (clase distintiva)", () => {
    const { container } = render(<Badge variant="expired">Expirado</Badge>);
    const badge = container.firstChild as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.className).toContain("bg-muted");
  });

  it("variant es required en el tipo — omitirlo debe ser TS error", () => {
    // El @ts-expect-error de abajo VALIDA en compile time que omitir
    // `variant` rompe el typecheck. Si el día de mañana alguien agrega
    // un default y deja `variant` opcional, el ts-expect-error queda
    // "sin error", y vitest falla este test con un type-check error —
    // que es exactamente la regresión que queremos cazar.
    const { container } = render(
      // @ts-expect-error variant es required
      <Badge>foo</Badge>,
    );
    // El render runtime no debe romper aunque el contract de tipos esté
    // violado (defensive: React no explota por una prop faltante).
    expect(container.firstChild).not.toBeNull();
  });

  it("children null/undefined → no rompe (graceful)", () => {
    expect(() =>
      render(<Badge variant="owner">{null}</Badge>),
    ).not.toThrow();
    expect(() =>
      render(<Badge variant="owner">{undefined}</Badge>),
    ).not.toThrow();
  });
});
