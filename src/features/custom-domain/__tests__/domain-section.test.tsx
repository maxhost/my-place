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
