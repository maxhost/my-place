import { describe, expect, it } from "vitest";

import { mapTransferError } from "../map-transfer-error";

// Tests puros del mapeo DEFINER error → `TransferError` tag. Espejo de
// migration 0016 (`app.transfer_founder_ownership`, S4 Feature D — reutilizada
// por Feature E S8).

describe("mapTransferError (S8, _lib pure)", () => {
  it("SQLSTATE 28000 → 'unauthorized'", () => {
    const err = Object.assign(new Error("no autenticado"), { code: "28000" });
    expect(mapTransferError(err)).toBe("unauthorized");
  });

  it("SQLSTATE P0002 → 'unauthorized'", () => {
    const err = Object.assign(
      new Error("app_user inexistente para el caller"),
      { code: "P0002" },
    );
    expect(mapTransferError(err)).toBe("unauthorized");
  });

  it("'place not found' → 'place_not_found'", () => {
    const err = Object.assign(new Error("place not found"), { code: "P0001" });
    expect(mapTransferError(err)).toBe("place_not_found");
  });

  it("'caller is not the founder of this place' → 'not_founder'", () => {
    const err = Object.assign(
      new Error("caller is not the founder of this place"),
      { code: "P0001" },
    );
    expect(mapTransferError(err)).toBe("not_founder");
  });

  it("'target is not an owner; elevate first' → 'target_not_owner'", () => {
    const err = Object.assign(
      new Error("target is not an owner; elevate first"),
      { code: "P0001" },
    );
    expect(mapTransferError(err)).toBe("target_not_owner");
  });

  it("'cannot transfer to self' → 'cannot_transfer_to_self'", () => {
    const err = Object.assign(new Error("cannot transfer to self"), {
      code: "P0001",
    });
    expect(mapTransferError(err)).toBe("cannot_transfer_to_self");
  });

  it("error desconocido → 'generic'", () => {
    const err = new Error("connection terminated unexpectedly");
    expect(mapTransferError(err)).toBe("generic");
  });
});
