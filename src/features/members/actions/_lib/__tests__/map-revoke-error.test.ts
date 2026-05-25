import { describe, expect, it } from "vitest";

import { mapRevokeInviteError } from "../map-revoke-error";

// Tests puros del mapeo DEFINER error → `RevokeInviteError` tag. Espejo de
// migration 0019 (`app.revoke_invitation`).

describe("mapRevokeInviteError (S7, _lib pure)", () => {
  it("SQLSTATE 28000 → 'unauthorized'", () => {
    const err = Object.assign(new Error("no autenticado"), { code: "28000" });
    expect(mapRevokeInviteError(err)).toBe("unauthorized");
  });

  it("'invitation not found' → 'not_found'", () => {
    const err = Object.assign(new Error("invitation not found"), {
      code: "P0001",
    });
    expect(mapRevokeInviteError(err)).toBe("not_found");
  });

  it("'caller is not an owner of this place' → 'not_owner'", () => {
    const err = Object.assign(
      new Error("caller is not an owner of this place"),
      { code: "P0001" },
    );
    expect(mapRevokeInviteError(err)).toBe("not_owner");
  });

  it("'cannot revoke already-accepted invitation' → 'already_accepted'", () => {
    const err = Object.assign(
      new Error("cannot revoke already-accepted invitation"),
      { code: "P0001" },
    );
    expect(mapRevokeInviteError(err)).toBe("already_accepted");
  });

  it("error desconocido → 'generic'", () => {
    const err = new Error("connection terminated unexpectedly");
    expect(mapRevokeInviteError(err)).toBe("generic");
  });
});
