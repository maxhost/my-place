import { describe, expect, it } from "vitest";

import { mapRevokeOwnershipError } from "../map-revoke-ownership-error";

// Tests puros del mapeo DEFINER error → `RevokeError` tag. Espejo de
// migration 0015 (`app.revoke_ownership`, S3 Feature D — reutilizada por
// Feature E S8). La DEFINER con mayor superficie de errores: 7 ramas
// distintas (unauthorized + 5 P0001 + generic).

describe("mapRevokeOwnershipError (S8, _lib pure)", () => {
  it("SQLSTATE 28000 → 'unauthorized'", () => {
    const err = Object.assign(new Error("no autenticado"), { code: "28000" });
    expect(mapRevokeOwnershipError(err)).toBe("unauthorized");
  });

  it("SQLSTATE P0002 → 'unauthorized'", () => {
    const err = Object.assign(
      new Error("app_user inexistente para el caller"),
      { code: "P0002" },
    );
    expect(mapRevokeOwnershipError(err)).toBe("unauthorized");
  });

  it("'caller is not an owner of this place' → 'not_owner'", () => {
    const err = Object.assign(
      new Error("caller is not an owner of this place"),
      { code: "P0001" },
    );
    expect(mapRevokeOwnershipError(err)).toBe("not_owner");
  });

  it("'target is not an owner of this place' → 'target_not_owner'", () => {
    const err = Object.assign(
      new Error("target is not an owner of this place"),
      { code: "P0001" },
    );
    expect(mapRevokeOwnershipError(err)).toBe("target_not_owner");
  });

  it("'cannot revoke founder ownership' → 'cannot_revoke_founder'", () => {
    const err = Object.assign(new Error("cannot revoke founder ownership"), {
      code: "P0001",
    });
    expect(mapRevokeOwnershipError(err)).toBe("cannot_revoke_founder");
  });

  it("'cannot self-revoke ownership; use transfer or future step-down' → 'cannot_self_revoke'", () => {
    const err = Object.assign(
      new Error("cannot self-revoke ownership; use transfer or future step-down"),
      { code: "P0001" },
    );
    expect(mapRevokeOwnershipError(err)).toBe("cannot_self_revoke");
  });

  it("'cannot revoke the only remaining owner' → 'last_owner'", () => {
    const err = Object.assign(
      new Error("cannot revoke the only remaining owner"),
      { code: "P0001" },
    );
    expect(mapRevokeOwnershipError(err)).toBe("last_owner");
  });

  it("error desconocido → 'generic'", () => {
    const err = new Error("connection terminated unexpectedly");
    expect(mapRevokeOwnershipError(err)).toBe("generic");
  });
});
