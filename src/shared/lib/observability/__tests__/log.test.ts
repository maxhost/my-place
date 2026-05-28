import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock `@sentry/nextjs` antes de importar el módulo bajo test. El wrapper
// importa el SDK at module-eval; el mock tiene que estar registrado primero
// para que la import-resolution use los stubs en vez de la lib real.
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";

import { log } from "../log";

// Tests del wrapper `log.*` (ADR-0047). Cubren el contrato API minimal:
//   - `log.info`: console.info structured JSON; NO Sentry (avoid quota burn).
//   - `log.warn`: console.warn + Sentry.captureMessage(level: "warning").
//   - `log.error`: console.error + Sentry.captureException(err, extras).
//   - Defense-in-depth: una excepción del SDK Sentry NUNCA debe propagarse
//     al caller (la app es más importante que el logger).
//
// Mocks: `@sentry/nextjs` mocked at module-level (vi.mock); `console.*`
// spied per-test con mockImplementation para no contaminar stdout.

describe("log wrapper", () => {
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("log.info", () => {
    it("emite JSON structured a console.info con level + message + meta", () => {
      log.info({ scope: "test", userId: "u1" }, "operation succeeded");
      expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
      const raw = consoleInfoSpy.mock.calls[0]?.[0];
      expect(typeof raw).toBe("string");
      const payload = JSON.parse(raw as string) as Record<string, unknown>;
      expect(payload).toEqual({
        level: "info",
        message: "operation succeeded",
        scope: "test",
        userId: "u1",
      });
    });

    it("NO llama a Sentry (info no quema cuota)", () => {
      log.info({ scope: "test" }, "noise");
      expect(Sentry.captureException).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });
  });

  describe("log.warn", () => {
    it("emite JSON structured a console.warn Y Sentry.captureMessage level=warning", () => {
      log.warn({ scope: "test", op: "x" }, "deprecation");
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(
        consoleWarnSpy.mock.calls[0]?.[0] as string,
      ) as Record<string, unknown>;
      expect(payload).toEqual({
        level: "warn",
        message: "deprecation",
        scope: "test",
        op: "x",
      });
      expect(Sentry.captureMessage).toHaveBeenCalledWith("deprecation", {
        level: "warning",
        extra: { scope: "test", op: "x" },
      });
    });

    it("traga excepciones del SDK Sentry (el caller no se entera)", () => {
      vi.mocked(Sentry.captureMessage).mockImplementationOnce(() => {
        throw new Error("sentry network blip");
      });
      expect(() => log.warn({}, "x")).not.toThrow();
      // El console.warn aún corrió — fuente de verdad local intacta.
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("log.error", () => {
    it("emite JSON structured a console.error + el err raw Y captureException con meta+message en extra", () => {
      const err = new Error("boom");
      log.error(err, { scope: "test", userId: "u1" }, "operation failed");
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const args = consoleErrorSpy.mock.calls[0];
      const payload = JSON.parse(args?.[0] as string) as Record<string, unknown>;
      expect(payload).toMatchObject({
        level: "error",
        message: "operation failed",
        errMessage: "boom",
        scope: "test",
        userId: "u1",
      });
      // Segundo arg = el err raw (preserva stack para inspección Vercel logs).
      expect(args?.[1]).toBe(err);
      expect(Sentry.captureException).toHaveBeenCalledWith(err, {
        extra: { message: "operation failed", scope: "test", userId: "u1" },
      });
    });

    it("acepta non-Error throwables (string, objeto plano)", () => {
      log.error("string error", { scope: "test" }, "weird throw");
      expect(Sentry.captureException).toHaveBeenCalledWith("string error", {
        extra: { message: "weird throw", scope: "test" },
      });
      const payload = JSON.parse(
        consoleErrorSpy.mock.calls[0]?.[0] as string,
      ) as Record<string, unknown>;
      expect(payload.errMessage).toBe("string error");
    });

    it("traga excepciones del SDK Sentry (el caller no se entera)", () => {
      vi.mocked(Sentry.captureException).mockImplementationOnce(() => {
        throw new Error("sentry network blip");
      });
      expect(() => log.error(new Error("boom"), {}, "msg")).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });
  });
});
