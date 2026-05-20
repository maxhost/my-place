import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InboxPlace } from "../domain/inbox-payload";
import type { InboxLabels } from "../ui/inbox-labels";
import { PlaceCard } from "../ui/place-card";

// Tests del card del place (S4 del Hub V1, `docs/features/inbox/spec.md`
// §"Lista de places" + §"Badges + acciones por estado"). El card es el
// componente con más UX condicional del slice: 4 estados × ownership cruza
// matriz de visibilidad de botones y opacidad. Resumen de la matriz V1
// (spec §"Badges + acciones por estado"):
//
//   ACTIVE  + owner   → "Entrar" + "Configurar" + sin atenuar
//   ACTIVE  + member  → sólo "Entrar"           + sin atenuar
//   resto                → 0 botones                + card atenuado (opacity-60)
//
// "Por qué no mostrar acciones disabled" (spec §G4 refinado): un botón
// disabled invita a clickearlo y frustra. Ocultarlo elimina la fricción —
// el estado lo cuenta el badge, sin promesa rota.
//
// Detalles técnicos:
//
// - El href de "Entrar" y "Configurar" usa `https://{slug}.{rootDomain()}/`
//   — cross-subdomain (el user está en `app.place.community/...`, el place
//   vive en `{slug}.place.community/...`). En tests `rootDomain()` cae al
//   fallback `"place.community"` (no hay `NEXT_PUBLIC_APP_URL` en jsdom).
// - El cuadrado del card lleva `themeAccent` inline (no clase Tailwind: es
//   runtime, custom por place). `null` → fallback con clase del producto.
// - `cardMemberSince` es template con `{date}`; el componente reemplaza
//   `{date}` con `Intl.DateTimeFormat(locale, …)`. Los tests aceptan
//   cualquier formato ICU (regex flexible) para no acoplar a la versión
//   de Node/ICU del runner.

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

const PLACE: InboxPlace = {
  id: "p1",
  slug: "mi-club",
  name: "Mi Club",
  themeAccent: "#aabbcc",
  status: "ACTIVE",
  isOwner: true,
  memberSince: new Date("2024-03-15T10:00:00Z"),
};

describe("PlaceCard — card del place en la vista 'Tus lugares' del Hub", () => {
  it("renderea nombre, subdomain canónico y 'Miembro desde' formateado", () => {
    render(<PlaceCard place={PLACE} labels={LABELS} locale="es" />);
    expect(screen.getByText("Mi Club")).toBeInTheDocument();
    expect(screen.getByText("mi-club.place.community")).toBeInTheDocument();
    // Aceptamos cualquier formato ICU (e.g. "marzo de 2024", "marzo 2024",
    // "March 2024") — el contract es "el {date} se reemplaza correctamente".
    expect(screen.getByText(/Miembro desde .*2024/i)).toBeInTheDocument();
  });

  it("muestra las iniciales del nombre en el cuadrado coloreado ('MC' para 'Mi Club')", () => {
    render(<PlaceCard place={PLACE} labels={LABELS} locale="es" />);
    expect(screen.getByText("MC")).toBeInTheDocument();
  });

  it("themeAccent del place se aplica inline al cuadrado (no clase Tailwind)", () => {
    const { container } = render(
      <PlaceCard place={PLACE} labels={LABELS} locale="es" />,
    );
    const square = container.querySelector('[data-testid="place-square"]');
    expect(square).not.toBeNull();
    // jsdom normaliza el hex a rgb() en getComputedStyle
    expect(square).toHaveStyle({ backgroundColor: "rgb(170, 187, 204)" });
  });

  it("themeAccent null → fallback (sin backgroundColor inline)", () => {
    const placeNoTheme: InboxPlace = { ...PLACE, themeAccent: null };
    const { container } = render(
      <PlaceCard place={placeNoTheme} labels={LABELS} locale="es" />,
    );
    const square = container.querySelector(
      '[data-testid="place-square"]',
    ) as HTMLElement | null;
    expect(square).not.toBeNull();
    // El fallback viene por clase Tailwind del producto (bg-accent); no hay
    // backgroundColor inline cuando themeAccent es null.
    expect(square!.style.backgroundColor).toBe("");
  });

  it("status ACTIVE + isOwner → 'Entrar' y 'Configurar' con hrefs subdomain + target/rel", () => {
    render(<PlaceCard place={PLACE} labels={LABELS} locale="es" />);
    const entrar = screen.getByRole("link", { name: "Entrar" });
    const configurar = screen.getByRole("link", { name: "Configurar" });
    expect(entrar).toHaveAttribute("href", "https://mi-club.place.community/");
    expect(configurar).toHaveAttribute(
      "href",
      "https://mi-club.place.community/settings",
    );
    expect(entrar).toHaveAttribute("target", "_blank");
    expect(entrar).toHaveAttribute("rel", "noopener noreferrer");
    expect(configurar).toHaveAttribute("target", "_blank");
    expect(configurar).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("status ACTIVE + !isOwner → sólo 'Entrar', sin 'Configurar'", () => {
    const member: InboxPlace = { ...PLACE, isOwner: false };
    render(<PlaceCard place={member} labels={LABELS} locale="es" />);
    expect(screen.getByRole("link", { name: "Entrar" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Configurar" }),
    ).not.toBeInTheDocument();
  });

  it("status PAYMENT_PENDING → 0 botones + card atenuado (opacity-60) + badge", () => {
    const pending: InboxPlace = { ...PLACE, status: "PAYMENT_PENDING" };
    const { container } = render(
      <PlaceCard place={pending} labels={LABELS} locale="es" />,
    );
    expect(
      screen.queryByRole("link", { name: "Entrar" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Configurar" }),
    ).not.toBeInTheDocument();
    expect((container.firstChild as HTMLElement).className).toContain(
      "opacity-60",
    );
    expect(screen.getByText("Pago pendiente")).toBeInTheDocument();
  });

  it("status INACTIVE → 0 botones + atenuado + badge 'Cerrado'", () => {
    const inactive: InboxPlace = { ...PLACE, status: "INACTIVE" };
    const { container } = render(
      <PlaceCard place={inactive} labels={LABELS} locale="es" />,
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect((container.firstChild as HTMLElement).className).toContain(
      "opacity-60",
    );
    expect(screen.getByText("Cerrado")).toBeInTheDocument();
  });
});
