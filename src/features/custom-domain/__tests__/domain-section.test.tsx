import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  makeRecord,
  makeRegister,
  resetClipboard,
  setup,
  stubClipboard,
} from "./_domain-section-helpers";

// Tests Client del componente `<DomainSection>` — superficie render + submit
// + validación (S4 feature custom-domain V1, `docs/features/custom-domain/
// spec.md` §"UI states"). Tests de interacciones avanzadas (confirm dialog,
// clipboard, auto-refresh, idempotencia) viven en `domain-section-
// interactions.test.tsx` — splittear por LOC (CLAUDE.md §"Límites de
// tamaño": archivo ≤300). Helpers compartidos en `_domain-section-helpers`.
//
// jsdom + RTL + userEvent — seam-split canónico: el Client recibe
// `registerAction` / `archiveAction` por prop, los tests inyectan
// `vi.fn()` con el resultado deseado. El cableado vivo de las Server
// Actions vs Neon + Vercel NO se testea acá (canon
// `update-default-locale.ts:13`); la correctitud del action es tipo/build
// + smoke prod.
//
// Cobertura de este archivo:
//   1.  Render state="none" → form vacío.
//   2.  Render state="pending" con DNS records → banner + tabla + sla + remover.
//   3.  Render state="pending" con `vercelUnavailable` → copy alternativo, sin
//       tabla.
//   4.  Render state="verified" → badge + dominio + botón remover.
//   5.  Submit happy: action invocada con (placeSlug, domain) normalizado.
//   6.  Submit cliente inválido (`foo`) → notice errorInvalidDomain; action NO
//       invocada.
//   7.  Submit cliente IDN (`münchen.de`) → notice errorIdnNotSupported; sin
//       action.
//   8.  Submit cliente reserved (`place.community`) → notice errorReserved.
//   9.  Action retorna `domain_taken` → notice mapeado errorDomainTaken.

beforeEach(stubClipboard);
afterEach(resetClipboard);

describe("DomainSection — estado none (form vacío)", () => {
  it("render: muestra title + input + botón 'Vincular dominio' y arranca disabled (input vacío)", () => {
    setup({ state: { status: "none" } });
    expect(screen.getByRole("heading", { name: "Dominio" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tu dominio")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Vincular dominio" }),
    ).toBeDisabled();
  });

  it("type valor → botón habilitado (dirty)", async () => {
    const user = userEvent.setup();
    setup({ state: { status: "none" } });
    await user.type(screen.getByLabelText("Tu dominio"), "foo.example.com");
    expect(
      screen.getByRole("button", { name: "Vincular dominio" }),
    ).toBeEnabled();
  });

  // ─── Placeholder {slug} en description (task #111) ────────────────────
  // El label `description` contiene `{slug}` literal. El componente lo
  // resuelve vía `String.replace` con el `placeSlug` prop — mismo patrón
  // que `archiveConfirmBody` (`domain-section-archive.tsx:119`). Antes
  // de #111 el placeholder se mostraba sin resolver en producción.

  it("description resuelve `{slug}` con el placeSlug del place (`mi-club` por default del setup)", () => {
    setup({ state: { status: "none" } });
    expect(
      screen.getByText(
        "Vinculá tu dominio propio. Tu lugar va a seguir disponible en mi-club.place.community siempre.",
      ),
    ).toBeInTheDocument();
    // Defense-in-depth: el literal `{slug}` NO debe aparecer en el DOM.
    expect(screen.queryByText(/\{slug\}/)).not.toBeInTheDocument();
  });

  it("description resuelve `{slug}` con un placeSlug arbitrario", () => {
    setup({ state: { status: "none" }, placeSlug: "comunidad-de-test" });
    expect(
      screen.getByText(
        "Vinculá tu dominio propio. Tu lugar va a seguir disponible en comunidad-de-test.place.community siempre.",
      ),
    ).toBeInTheDocument();
  });
});

describe("DomainSection — estado pending", () => {
  it("render con `dnsRecords` populated: dominio en bold + tabla 3 records + sla + botón Remover", () => {
    setup({
      state: {
        status: "pending",
        record: makeRecord({ domain: "comunidad.mi-marca.com" }),
        dnsRecords: [
          { type: "A", name: "@", value: "76.76.21.21" },
          { type: "TXT", name: "_vercel.comunidad", value: "vc-challenge-xyz" },
          {
            type: "CNAME",
            name: "www.comunidad",
            value: "cname.vercel-dns.com",
          },
        ],
      },
    });
    // Título del banner + dominio resaltado.
    expect(screen.getByText("Verificando configuración DNS")).toBeInTheDocument();
    expect(screen.getByText("comunidad.mi-marca.com")).toBeInTheDocument();
    // Tabla — header columns.
    expect(screen.getByRole("columnheader", { name: "Tipo" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Nombre" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Valor" })).toBeInTheDocument();
    // 3 filas de records (más la fila de headers).
    expect(screen.getAllByRole("row")).toHaveLength(4);
    // SLA + botón.
    expect(
      screen.getByText("La propagación puede tardar entre minutos y horas."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remover" })).toBeInTheDocument();
  });

  it("render con `vercelUnavailable: true` → copy alternativo, NO tabla DNS", () => {
    setup({
      state: {
        status: "pending",
        record: makeRecord(),
        dnsRecords: null,
        vercelUnavailable: true,
      },
    });
    expect(
      screen.getByText(
        "Estamos verificando con Vercel, intentamos de nuevo en breve.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // El botón Remover sigue disponible.
    expect(screen.getByRole("button", { name: "Remover" })).toBeInTheDocument();
  });

  // ─── Banner downreverted (ADR-0029) ─────────────────────────────────────
  // Cuando `state.wasDownreverted === true` (lazy poll detectó V6
  // `misconfigured: true` sobre un dominio que estaba verified → reseteó
  // `verified_at = NULL`), arriba del pending notice debe aparecer un banner
  // explicando al owner que tiene que reconfigurar sus records.

  it("render con `wasDownreverted: true` → banner downreverted con título + body con {domain} resuelto", () => {
    setup({
      state: {
        status: "pending",
        record: makeRecord({ domain: "comunidad.mi-marca.com" }),
        dnsRecords: [
          { type: "A", name: "@", value: "76.76.21.21" },
        ],
        wasDownreverted: true,
      },
    });
    expect(
      screen.getByText("Tu dominio dejó de funcionar"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Detectamos que el DNS de comunidad.mi-marca.com ya no apunta a Place.",
      ),
    ).toBeInTheDocument();
    // El pending notice + tabla siguen visibles abajo.
    expect(
      screen.getByText("Verificando configuración DNS"),
    ).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("render con `wasDownreverted: undefined` (default) → banner downreverted ausente", () => {
    setup({
      state: {
        status: "pending",
        record: makeRecord({ domain: "comunidad.mi-marca.com" }),
        dnsRecords: [{ type: "A", name: "@", value: "76.76.21.21" }],
      },
    });
    expect(
      screen.queryByText("Tu dominio dejó de funcionar"),
    ).not.toBeInTheDocument();
  });

  it("render con `wasDownreverted: false` explícito → banner ausente", () => {
    setup({
      state: {
        status: "pending",
        record: makeRecord({ domain: "comunidad.mi-marca.com" }),
        dnsRecords: [{ type: "A", name: "@", value: "76.76.21.21" }],
        wasDownreverted: false,
      },
    });
    expect(
      screen.queryByText("Tu dominio dejó de funcionar"),
    ).not.toBeInTheDocument();
  });
});

describe("DomainSection — estado verified", () => {
  it("render: badge + dominio + descripción + botón Remover", () => {
    setup({
      state: {
        status: "verified",
        record: makeRecord({
          domain: "comunidad.mi-marca.com",
          verifiedAt: new Date("2026-05-10T12:00:00.000Z"),
        }),
      },
    });
    expect(screen.getByText("Verificado, SSL activo")).toBeInTheDocument();
    expect(screen.getByText("comunidad.mi-marca.com")).toBeInTheDocument();
    expect(
      screen.getByText("Tu dominio está listo y con SSL emitido."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remover" })).toBeInTheDocument();
  });

  // ─── Description contextual por estado (task #112) ────────────────────
  // En verified, el header description cambia de la copy "Conectá un
  // dominio propio..." (none/pending) a una verified-específica que
  // referencia el dominio configurado. El placeholder `{domain}` se
  // resuelve con `state.record.domain`.

  it("description usa el copy verified con `{domain}` resuelto", () => {
    setup({
      state: {
        status: "verified",
        record: makeRecord({
          domain: "comunidad.mi-marca.com",
          verifiedAt: new Date("2026-05-10T12:00:00.000Z"),
        }),
      },
    });
    expect(
      screen.getByText(
        "Tu dominio ya está configurado. Los miembros pueden acceder desde comunidad.mi-marca.com.",
      ),
    ).toBeInTheDocument();
    // Defense-in-depth: el copy de none/pending NO debe aparecer.
    expect(
      screen.queryByText(/Vinculá tu dominio propio/),
    ).not.toBeInTheDocument();
    // Y el placeholder literal tampoco.
    expect(screen.queryByText(/\{domain\}/)).not.toBeInTheDocument();
  });

  it("description en `none` o `pending` mantiene el copy con `{slug}` (regresión #111)", () => {
    setup({ state: { status: "none" }, placeSlug: "otro-place" });
    expect(
      screen.getByText(
        "Vinculá tu dominio propio. Tu lugar va a seguir disponible en otro-place.place.community siempre.",
      ),
    ).toBeInTheDocument();
  });
});

describe("DomainSection — submit happy + validación cliente", () => {
  it("submit happy: invoca `registerAction` 1 vez con {placeSlug, domain} exactos", async () => {
    const user = userEvent.setup();
    const registerAction = makeRegister();
    setup({
      state: { status: "none" },
      placeSlug: "mi-club",
      registerAction,
    });
    await user.type(screen.getByLabelText("Tu dominio"), "comunidad.test.com");
    await user.click(screen.getByRole("button", { name: "Vincular dominio" }));

    await waitFor(() => expect(registerAction).toHaveBeenCalledTimes(1));
    expect(registerAction).toHaveBeenCalledWith({
      placeSlug: "mi-club",
      domain: "comunidad.test.com",
    });
  });

  it("submit cliente inválido (`foo` sin TLD): notice errorInvalidDomain; action NO invocada", async () => {
    const user = userEvent.setup();
    const registerAction = makeRegister();
    setup({ state: { status: "none" }, registerAction });
    await user.type(screen.getByLabelText("Tu dominio"), "foo");
    await user.click(screen.getByRole("button", { name: "Vincular dominio" }));

    expect(await screen.findByText("Dominio inválido.")).toBeInTheDocument();
    expect(registerAction).not.toHaveBeenCalled();
  });

  it("submit IDN cliente (`münchen.de`): notice errorIdnNotSupported; action NO invocada", async () => {
    const user = userEvent.setup();
    const registerAction = makeRegister();
    setup({ state: { status: "none" }, registerAction });
    await user.type(screen.getByLabelText("Tu dominio"), "münchen.de");
    await user.click(screen.getByRole("button", { name: "Vincular dominio" }));

    expect(
      await screen.findByText("Por ahora aceptamos solo dominios ASCII."),
    ).toBeInTheDocument();
    expect(registerAction).not.toHaveBeenCalled();
  });

  it("submit reservado cliente (`place.community`): notice errorReserved; action NO invocada", async () => {
    const user = userEvent.setup();
    const registerAction = makeRegister();
    setup({ state: { status: "none" }, registerAction });
    await user.type(screen.getByLabelText("Tu dominio"), "place.community");
    await user.click(screen.getByRole("button", { name: "Vincular dominio" }));

    expect(
      await screen.findByText("Ese dominio está reservado."),
    ).toBeInTheDocument();
    expect(registerAction).not.toHaveBeenCalled();
  });

  it("submit server error mapping: `domain_taken` → notice errorDomainTaken", async () => {
    const user = userEvent.setup();
    const registerAction = makeRegister({
      status: "error",
      reason: "domain_taken",
    });
    setup({ state: { status: "none" }, registerAction });
    await user.type(screen.getByLabelText("Tu dominio"), "comunidad.test.com");
    await user.click(screen.getByRole("button", { name: "Vincular dominio" }));

    expect(
      await screen.findByText(
        "Ese dominio ya está vinculado a otro lugar de Place.",
      ),
    ).toBeInTheDocument();
    expect(registerAction).toHaveBeenCalledTimes(1);
  });
});
