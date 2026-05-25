import { describe, expect, it } from "vitest";

import { mapRemoveMemberError } from "../map-remove-member-error";

// Tests puros del mapeo DEFINER error → `RemoveMemberError` tag. Espejo de
// migration 0020 (`app.remove_member`, S4 Feature E) — cubre cada rama
// observable (`unauthorized` agrupa 28000 + P0002; 4 ramas P0001 discriminadas
// por message; default `generic`).

describe("mapRemoveMemberError (S8, _lib pure)", () => {
  it("SQLSTATE 28000 / 'no autenticado' → 'unauthorized'", () => {
    const err = Object.assign(new Error("no autenticado"), { code: "28000" });
    expect(mapRemoveMemberError(err)).toBe("unauthorized");
  });

  it("SQLSTATE P0002 ('app_user inexistente') → 'unauthorized'", () => {
    const err = Object.assign(
      new Error("app_user inexistente para el caller"),
      { code: "P0002" },
    );
    expect(mapRemoveMemberError(err)).toBe("unauthorized");
  });

  it("'caller is not an owner of this place' → 'not_owner'", () => {
    const err = Object.assign(
      new Error("caller is not an owner of this place"),
      { code: "P0001" },
    );
    expect(mapRemoveMemberError(err)).toBe("not_owner");
  });

  it("'target is an owner; revoke ownership first' → 'target_is_owner'", () => {
    const err = Object.assign(
      new Error("target is an owner; revoke ownership first"),
      { code: "P0001" },
    );
    expect(mapRemoveMemberError(err)).toBe("target_is_owner");
  });

  it("'cannot self-remove; use leave_place (V1.1+)' → 'cannot_self_remove'", () => {
    const err = Object.assign(
      new Error("cannot self-remove; use leave_place (V1.1+)"),
      { code: "P0001" },
    );
    expect(mapRemoveMemberError(err)).toBe("cannot_self_remove");
  });

  it("'target is not an active member' → 'target_not_active_member'", () => {
    const err = Object.assign(new Error("target is not an active member"), {
      code: "P0001",
    });
    expect(mapRemoveMemberError(err)).toBe("target_not_active_member");
  });

  it("error desconocido (red, drift, etc.) → 'generic'", () => {
    const err = new Error("connection terminated unexpectedly");
    expect(mapRemoveMemberError(err)).toBe("generic");
  });
});
