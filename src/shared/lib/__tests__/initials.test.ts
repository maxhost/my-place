import { describe, expect, it } from "vitest";
import { computeInitials } from "../initials";

// Tests del util `computeInitials`. Movidos desde
// `features/nav-hub/__tests__/account-menu.test.tsx` cuando el helper pasó de
// vivir adentro del slice nav-hub a `shared/lib` (S4 del Hub: el slice inbox
// también lo necesita; los slices no se importan entre sí — sólo desde
// `shared/`).

describe("computeInitials — derivación de iniciales del displayName", () => {
  it("dos palabras → primeras 2 iniciales en upper", () => {
    expect(computeInitials("Ana López")).toBe("AL");
  });

  it("una palabra → primera inicial", () => {
    expect(computeInitials("Ana")).toBe("A");
  });

  it("tres o más palabras → sólo las 2 primeras iniciales", () => {
    expect(computeInitials("Maria de los Ángeles")).toBe("MD");
  });

  it("whitespace extra se normaliza", () => {
    expect(computeInitials("  ana   maría  ")).toBe("AM");
  });

  it("null o vacío → null", () => {
    expect(computeInitials(null)).toBeNull();
    expect(computeInitials("")).toBeNull();
    expect(computeInitials("   ")).toBeNull();
  });
});
