import { describe, expect, it } from "vitest";

import { mapAcceptError } from "../map-accept-error";

// Espejo migration 0003 (`app.accept_invitation`). Cada SQLSTATE de la
// DEFINER mapea 1:1 a un `kind` del discriminated union (a diferencia de
// V1 InviteError/RevokeInviteError donde un solo P0001 cubre varios
// mensajes, V1.1 usa códigos UNIQUE por error → switch-by-code basta).

describe("mapAcceptError", () => {
  it("SQLSTATE 28000 → { kind: 'unauthenticated' }", () => {
    const err = Object.assign(new Error("no autenticado"), { code: "28000" });
    expect(mapAcceptError(err)).toEqual({ kind: "unauthenticated" });
  });

  it("SQLSTATE P0002 → { kind: 'app_user_missing' }", () => {
    const err = Object.assign(
      new Error("app_user inexistente para el caller"),
      { code: "P0002" },
    );
    expect(mapAcceptError(err)).toEqual({ kind: "app_user_missing" });
  });

  it("SQLSTATE P0005 → { kind: 'not_found' }", () => {
    const err = Object.assign(new Error("invitación inexistente"), {
      code: "P0005",
    });
    expect(mapAcceptError(err)).toEqual({ kind: "not_found" });
  });

  it("SQLSTATE P0006 → { kind: 'expired' }", () => {
    const err = Object.assign(new Error("invitación vencida"), {
      code: "P0006",
    });
    expect(mapAcceptError(err)).toEqual({ kind: "expired" });
  });

  it("SQLSTATE P0007 → { kind: 'already_used' }", () => {
    const err = Object.assign(new Error("invitación ya utilizada"), {
      code: "P0007",
    });
    expect(mapAcceptError(err)).toEqual({ kind: "already_used" });
  });

  it("SQLSTATE P0008 → { kind: 'email_mismatch' }", () => {
    const err = Object.assign(
      new Error("el email no coincide con la invitación"),
      { code: "P0008" },
    );
    expect(mapAcceptError(err)).toEqual({ kind: "email_mismatch" });
  });

  it("SQLSTATE P0009 → { kind: 'place_full' }", () => {
    const err = Object.assign(new Error("place lleno (máx 150 miembros)"), {
      code: "P0009",
    });
    expect(mapAcceptError(err)).toEqual({ kind: "place_full" });
  });

  it("SQLSTATE desconocido (drift, red, 5xx) → { kind: 'unknown' }", () => {
    const err = Object.assign(new Error("connection terminated unexpectedly"), {
      code: "XX000",
    });
    expect(mapAcceptError(err)).toEqual({ kind: "unknown" });
  });
});
