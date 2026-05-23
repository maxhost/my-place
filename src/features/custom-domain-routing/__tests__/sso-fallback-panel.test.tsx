import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  SsoFallbackPanel,
  type SsoFallbackLabels,
} from "../ui/sso-fallback-panel";

// Tests Client (jsdom + RTL) del `<SsoFallbackPanel>` (Feature C S6, ADR-0032
// §"UI fallback"). Componente presentacional puro (Server Component renderable
// en jsdom porque no consume `headers()`, `getTranslations` ni estado runtime
// — solo recibe props y emite JSX estático). Pattern paralelo al
// `<AuthGateForCustomDomain>` (S4d Feature B locked).
//
// ## Cobertura del contrato
//
// 1. **Render con labels canónicas** → failureTitle (h1), failureBody (parsed),
//    fallbackCta link, help/retry no aplica V1 (sólo CTA principal).
// 2. **Body con `**slug**`** → segmento bold parseado a `<strong>` (mismo
//    parser local que `auth-gate.tsx`).
// 3. **CTA absoluto** → `<a href={canonicalUrl}>` con `rel="noopener"`
//    (defense-in-depth cross-origin idéntico al auth-gate).
// 4. **`errorCode` opcional dentro de `<details>`** — para debug del owner sin
//    contaminar UX principal. Cuando `errorCode` es undefined, NO se renderea
//    el `<details>` (no clutter).
// 5. **Accesibilidad** — `<section>` raíz, `<h1>` con failureTitle, link
//    naturalmente focusable.
//
// ## Por qué no se testea i18n parity acá
//
// La paridad × 6 locales se enforce con `scripts/check-translations.mjs` (0/0
// drift sobre `customDomainRouting.sso.*`). Este suite valida shape del
// componente; el script valida shape del catálogo. Capas separadas.

const LABELS: SsoFallbackLabels = {
  failureTitle: "No pudimos iniciarte sesión automáticamente",
  failureBody:
    "Hubo un inconveniente al verificar tu identidad para **mi-place**. Podés volver a tu URL canónica para iniciar sesión manualmente.",
  fallbackCta: "Ir a mi-place en place.community",
};

function setup(over?: {
  labels?: Partial<SsoFallbackLabels>;
  canonicalUrl?: string;
  errorCode?: string;
}) {
  return render(
    <SsoFallbackPanel
      canonicalUrl={
        over?.canonicalUrl ?? "https://mi-place.place.community/settings"
      }
      labels={{ ...LABELS, ...over?.labels }}
      errorCode={over?.errorCode}
    />,
  );
}

describe("SsoFallbackPanel — render básico", () => {
  it("renderea failureTitle como h1", () => {
    setup();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "No pudimos iniciarte sesión automáticamente",
      }),
    ).toBeInTheDocument();
  });

  it("renderea estructura semántica con <section> raíz", () => {
    const { container } = setup();
    const section = container.querySelector("section");
    expect(section).not.toBeNull();
  });
});

describe("SsoFallbackPanel — body con **bold** markdown", () => {
  it("parsea `**slug**` a <strong> con el texto interno", () => {
    setup();
    const strong = screen.getByText("mi-place");
    expect(strong.tagName).toBe("STRONG");
  });

  it("preserva texto antes y después del segmento bold", () => {
    setup();
    expect(
      screen.getByText(/Hubo un inconveniente al verificar tu identidad para/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Podés volver a tu URL canónica para iniciar sesión manualmente/i,
      ),
    ).toBeInTheDocument();
  });

  it("render plano cuando body NO tiene `**...**`", () => {
    setup({ labels: { failureBody: "Texto sin formato bold." } });
    expect(screen.getByText("Texto sin formato bold.")).toBeInTheDocument();
  });

  it("parsea múltiples segmentos `**X**` (defense-in-depth)", () => {
    setup({
      labels: {
        failureBody: "Falló **uno** y también **dos** al verificar.",
      },
    });
    expect(screen.getByText("uno").tagName).toBe("STRONG");
    expect(screen.getByText("dos").tagName).toBe("STRONG");
  });
});

describe("SsoFallbackPanel — CTA link", () => {
  it("renderea CTA como <a> con href = canonicalUrl", () => {
    setup({
      canonicalUrl: "https://mi-place.place.community/settings/domain",
    });
    const link = screen.getByRole("link", { name: LABELS.fallbackCta });
    expect(link).toHaveAttribute(
      "href",
      "https://mi-place.place.community/settings/domain",
    );
  });

  it("aplica rel='noopener' para defense-in-depth cross-origin", () => {
    setup();
    const link = screen.getByRole("link", { name: LABELS.fallbackCta });
    const rel = link.getAttribute("rel") ?? "";
    expect(rel).toMatch(/noopener/);
  });
});

describe("SsoFallbackPanel — errorCode opcional", () => {
  it("renderea <details> cuando errorCode está definido", () => {
    const { container } = setup({ errorCode: "state_mismatch" });
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(within(details!).getByText(/state_mismatch/)).toBeInTheDocument();
  });

  it("NO renderea <details> cuando errorCode es undefined", () => {
    const { container } = setup();
    expect(container.querySelector("details")).toBeNull();
  });

  it("escapa valores arbitrarios de errorCode (no HTML inyectado)", () => {
    // Defense-in-depth: errorCode viene del query string del redeem; aunque
    // S8 sólo emite códigos enumerados, el componente NO debe interpretar
    // HTML si algún code futuro contiene caracteres especiales.
    const { container } = setup({ errorCode: "<script>alert(1)</script>" });
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    // React escapa text content automáticamente — el `<script>` literal NO
    // debe estar parsed como element.
    expect(container.querySelector("script")).toBeNull();
    expect(details!.textContent).toContain("<script>alert(1)</script>");
  });
});

describe("SsoFallbackPanel — accesibilidad", () => {
  it("body queda dentro de párrafo (no texto suelto)", () => {
    const { container } = setup();
    const paragraphs = container.querySelectorAll("p");
    const hasBodyParagraph = Array.from(paragraphs).some((p) =>
      within(p).queryByText("mi-place"),
    );
    expect(hasBodyParagraph).toBe(true);
  });

  it("link es navegable por teclado (tag <a> con href)", () => {
    setup();
    const link = screen.getByRole("link", { name: LABELS.fallbackCta });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href");
  });
});
