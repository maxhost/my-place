import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AuthGateForCustomDomain,
  type AuthGateLabels,
} from "../ui/auth-gate";

// Tests Client (jsdom + RTL) del `<AuthGateForCustomDomain>` (Feature B S4d,
// ADR-0031 §"Auth gate UX"). Componente presentacional puro (Server Component
// renderable en jsdom porque no consume `headers()`, `getTranslations` ni
// estado runtime — solo recibe props y emite JSX estático).
//
// Cobertura del contrato declarado en el spec:
//   1. Render con labels canónicas → title, body, cta, help visibles.
//   2. Body con `**slug**` → segmento bold parseado a `<strong>`.
//   3. Body con `**slug**` al medio → texto antes/después preservado.
//   4. Body SIN `**...**` → texto plano, sin `<strong>`.
//   5. Body con múltiples `**X**` → todos parseados (defense-in-depth aunque
//      el copy canónico tiene uno solo).
//   6. CTA renderiza como `<a href={canonicalUrl}>` con texto cta y rel.
//   7. CTA absoluto → `rel="noopener"` para defense-in-depth en navegación
//      cross-origin (custom-domain → subdomain canon).
//   8. Help renderiza con texto plano.
//   9. Estructura semántica: `<section>` raíz + `<h1>` con title (accesibilidad).

const LABELS: AuthGateLabels = {
  title: "Iniciá sesión en Place",
  body: "Para administrar **mi-place** tenés que iniciar sesión en su dirección original en Place.",
  cta: "Ir a mi-place.place.community",
  help: "Mientras tanto, tus visitantes pueden seguir usando este dominio normalmente.",
};

function setup(over?: {
  labels?: Partial<AuthGateLabels>;
  canonicalUrl?: string;
}) {
  return render(
    <AuthGateForCustomDomain
      canonicalUrl={over?.canonicalUrl ?? "https://mi-place.place.community/settings"}
      labels={{ ...LABELS, ...over?.labels }}
    />,
  );
}

describe("AuthGateForCustomDomain — render básico", () => {
  it("renderea title como h1", () => {
    setup();
    expect(
      screen.getByRole("heading", { level: 1, name: "Iniciá sesión en Place" }),
    ).toBeInTheDocument();
  });

  it("renderea help como texto plano", () => {
    setup();
    expect(screen.getByText(LABELS.help)).toBeInTheDocument();
  });

  it("renderea estructura semántica con <section> raíz", () => {
    const { container } = setup();
    const section = container.querySelector("section");
    expect(section).not.toBeNull();
  });
});

describe("AuthGateForCustomDomain — body con **bold** markdown", () => {
  it("parsea `**slug**` a <strong> con el texto interno", () => {
    setup();
    const strong = screen.getByText("mi-place");
    expect(strong.tagName).toBe("STRONG");
  });

  it("preserva texto antes y después del segmento bold", () => {
    setup();
    // Texto antes
    expect(screen.getByText(/Para administrar/i)).toBeInTheDocument();
    // Texto después
    expect(
      screen.getByText(/tenés que iniciar sesión en su dirección original/i),
    ).toBeInTheDocument();
  });

  it("render plano cuando body NO tiene `**...**`", () => {
    setup({ labels: { body: "Texto sin formato bold." } });
    expect(screen.getByText("Texto sin formato bold.")).toBeInTheDocument();
    expect(screen.queryByRole("strong")).not.toBeInTheDocument();
  });

  it("parsea múltiples segmentos `**X**` (defense-in-depth)", () => {
    setup({
      labels: {
        body: "Hola **uno** y también **dos** al final.",
      },
    });
    const uno = screen.getByText("uno");
    const dos = screen.getByText("dos");
    expect(uno.tagName).toBe("STRONG");
    expect(dos.tagName).toBe("STRONG");
  });

  it("no rompe con `**` no balanceado (fail-soft a texto)", () => {
    setup({
      labels: { body: "Texto con ** sin cerrar." },
    });
    expect(screen.getByText(/Texto con \*\* sin cerrar/)).toBeInTheDocument();
  });
});

describe("AuthGateForCustomDomain — CTA link", () => {
  it("renderea CTA como <a> con href = canonicalUrl", () => {
    setup({ canonicalUrl: "https://mi-place.place.community/settings/domain" });
    const link = screen.getByRole("link", { name: LABELS.cta });
    expect(link).toHaveAttribute(
      "href",
      "https://mi-place.place.community/settings/domain",
    );
  });

  it("aplica rel='noopener' para defense-in-depth cross-origin", () => {
    setup();
    const link = screen.getByRole("link", { name: LABELS.cta });
    const rel = link.getAttribute("rel") ?? "";
    expect(rel).toMatch(/noopener/);
  });

  it("respeta canonicalUrl con path arbitrario", () => {
    setup({
      canonicalUrl: "http://mi-place.localhost:3000/settings",
    });
    const link = screen.getByRole("link", { name: LABELS.cta });
    expect(link).toHaveAttribute(
      "href",
      "http://mi-place.localhost:3000/settings",
    );
  });
});

describe("AuthGateForCustomDomain — accesibilidad", () => {
  it("body queda dentro de elemento con role='region' o párrafo", () => {
    const { container } = setup();
    // El body debería estar en un párrafo, no como texto suelto del section
    const paragraphs = container.querySelectorAll("p");
    const hasBodyParagraph = Array.from(paragraphs).some((p) =>
      within(p).queryByText("mi-place"),
    );
    expect(hasBodyParagraph).toBe(true);
  });

  it("link es navegable por teclado (tabIndex implícito de <a>)", () => {
    setup();
    const link = screen.getByRole("link", { name: LABELS.cta });
    // <a> con href es naturalmente focusable
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href");
  });
});
