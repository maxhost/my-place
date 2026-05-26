import { describe, expect, it } from "vitest";

import { mapElevateError } from "../map-elevate-error";

// Tests puros del mapeo DEFINER error → `ElevateError` tag. Espejo de
// migration 0014 (`app.elevate_to_owner`, S2 Feature D — reutilizada por
// Feature E S8). Cubre cada rama observable.

describe("mapElevateError (S8, _lib pure)", () => {
  it("SQLSTATE 28000 → 'unauthorized'", () => {
    const err = Object.assign(new Error("no autenticado"), { code: "28000" });
    expect(mapElevateError(err)).toBe("unauthorized");
  });

  it("SQLSTATE P0002 → 'unauthorized'", () => {
    const err = Object.assign(
      new Error("app_user inexistente para el caller"),
      { code: "P0002" },
    );
    expect(mapElevateError(err)).toBe("unauthorized");
  });

  it("'place not found' → 'place_not_found'", () => {
    const err = Object.assign(new Error("place not found"), { code: "P0001" });
    expect(mapElevateError(err)).toBe("place_not_found");
  });

  it("'caller is not an owner of this place' → 'not_owner'", () => {
    const err = Object.assign(
      new Error("caller is not an owner of this place"),
      { code: "P0001" },
    );
    expect(mapElevateError(err)).toBe("not_owner");
  });

  it("'target is already an owner' → 'target_already_owner'", () => {
    const err = Object.assign(new Error("target is already an owner"), {
      code: "P0001",
    });
    expect(mapElevateError(err)).toBe("target_already_owner");
  });

  it("'target is not an active member' → 'target_not_member'", () => {
    const err = Object.assign(new Error("target is not an active member"), {
      code: "P0001",
    });
    expect(mapElevateError(err)).toBe("target_not_member");
  });

  it("error desconocido → 'generic'", () => {
    const err = new Error("connection terminated unexpectedly");
    expect(mapElevateError(err)).toBe("generic");
  });
});
