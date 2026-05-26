import { describe, expect, it } from "vitest";

import { mapHeadlineError } from "../map-headline-error";

// Tests puros del mapeo DEFINER error → `HeadlineError` tag. Espejo de
// migration 0017 (`app.update_my_headline`).

describe("mapHeadlineError (S7, _lib pure)", () => {
  it("SQLSTATE 28000 → 'unauthorized'", () => {
    const err = Object.assign(new Error("no autenticado"), { code: "28000" });
    expect(mapHeadlineError(err)).toBe("unauthorized");
  });

  it("SQLSTATE P0002 ('app_user inexistente') → 'unauthorized'", () => {
    const err = Object.assign(
      new Error("app_user inexistente para el caller"),
      { code: "P0002" },
    );
    expect(mapHeadlineError(err)).toBe("unauthorized");
  });

  it("'caller is not an active member of this place' → 'not_member'", () => {
    const err = Object.assign(
      new Error("caller is not an active member of this place"),
      { code: "P0001" },
    );
    expect(mapHeadlineError(err)).toBe("not_member");
  });

  it("error desconocido → 'generic'", () => {
    const err = new Error("connection terminated unexpectedly");
    expect(mapHeadlineError(err)).toBe("generic");
  });
});
