import { describe, expect, it } from "vitest";

import { mapInviteError } from "../map-invite-error";

// Tests puros del mapeo DEFINER error → `InviteError` tag. La función
// inspecciona `err.code` (SQLSTATE PG, preferido) + `err.message` (string
// del RAISE EXCEPTION). Espejo de migration 0018 (`app.create_invitation`)
// + migration 0017 P0002 reutilizable.

describe("mapInviteError (S7, _lib pure)", () => {
  it("SQLSTATE 28000 / 'no autenticado' → 'unauthorized'", () => {
    const err = Object.assign(new Error("no autenticado"), { code: "28000" });
    expect(mapInviteError(err)).toBe("unauthorized");
  });

  it("'caller is not an owner of this place' → 'not_owner'", () => {
    const err = Object.assign(
      new Error("caller is not an owner of this place"),
      { code: "P0001" },
    );
    expect(mapInviteError(err)).toBe("not_owner");
  });

  it("'expires_at must be in the future' → 'expires_in_past'", () => {
    const err = Object.assign(
      new Error("expires_at must be in the future"),
      { code: "P0001" },
    );
    expect(mapInviteError(err)).toBe("expires_in_past");
  });

  it("SQLSTATE P0002 ('app_user inexistente') → 'unauthorized'", () => {
    const err = Object.assign(
      new Error("app_user inexistente para el caller"),
      { code: "P0002" },
    );
    expect(mapInviteError(err)).toBe("unauthorized");
  });

  it("error desconocido (red, drift, etc.) → 'generic'", () => {
    const err = new Error("connection terminated unexpectedly");
    expect(mapInviteError(err)).toBe("generic");
  });
});
