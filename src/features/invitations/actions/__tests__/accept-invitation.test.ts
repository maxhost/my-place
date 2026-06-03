import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentUserIdentityForRequest } from "@/shared/lib/current-user-identity";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";
import { ensureAppUser } from "@/shared/lib/ensure-app-user";
import { enforceRateLimit, getRequestIp } from "@/shared/lib/rate-limit";

import { acceptInvitationAction } from "../accept-invitation";

// Phase 2.C.3 — branch coverage del wrapper `acceptInvitationAction`. Es
// orquestación pura (Zod gate → rate limit → identity zone-aware → TX1
// ensureAppUser → TX2 DEFINER → map error). Todo el borde cross-system se
// mockea: el integrador `getAuthenticatedDbForRequest` (next/headers + cookies
// + pool Neon), la identidad, `ensureAppUser`, y el rate limiter. El wiring
// vivo (DEFINER `app.accept_invitation`) se verifica en integration
// (`src/db/__tests__/accept-invitation.test.ts`) + smoke E2E, NO acá. Acá
// cubrimos las ramas TS: Zod fail, rate_limited (+ derivación), unauthenticated,
// happy, rows vacías → unknown, y el catch (DEFINER throw → map por SQLSTATE).

vi.mock("@/shared/lib/current-user-identity", () => ({
  getCurrentUserIdentityForRequest: vi.fn(),
}));
vi.mock("@/shared/lib/db-for-request", () => ({
  getAuthenticatedDbForRequest: vi.fn(),
}));
vi.mock("@/shared/lib/ensure-app-user", () => ({ ensureAppUser: vi.fn() }));
vi.mock("@/shared/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  getRequestIp: vi.fn(),
}));

const mockIdentity = vi.mocked(getCurrentUserIdentityForRequest);
const mockGetDb = vi.mocked(getAuthenticatedDbForRequest);
const mockEnsure = vi.mocked(ensureAppUser);
const mockEnforce = vi.mocked(enforceRateLimit);
const mockGetIp = vi.mocked(getRequestIp);

// El runtime genera 64-hex; el schema acepta [32, 256].
const VALID_TOKEN = "a".repeat(64);

// Stand-in del `SqlExecutor`: el integrador real invoca `fn(sql, claims)`, así
// que replicamos esa invocación inline para EJECUTAR el callback de la action
// (cubre las líneas `ensureAppUser(sql, …)` y `sql('SELECT …')`).
const sqlExecutor = vi.fn();

function allowRateLimit() {
  mockEnforce.mockResolvedValue({
    mode: "enforced",
    success: true,
    remaining: 4,
    resetAt: 0,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetIp.mockResolvedValue("203.0.113.7");
  allowRateLimit();
  mockIdentity.mockResolvedValue({
    authUserId: "auth-1",
    email: "ana@ejemplo.com",
    displayName: "Ana",
  });
  mockEnsure.mockResolvedValue("appuser-1");
  sqlExecutor.mockResolvedValue([{ slug: "mi-place" }]);
  mockGetDb.mockImplementation(
    async (fn) => fn(sqlExecutor as never, { sub: "auth-1" }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("acceptInvitationAction (Phase 2.C.3)", () => {
  it("happy path: ensureAppUser + DEFINER retorna slug → success", async () => {
    const result = await acceptInvitationAction({ token: VALID_TOKEN });

    expect(result).toEqual({ status: "success", placeSlug: "mi-place" });
    // TX1 (ensureAppUser) + TX2 (SELECT) = 2 pasadas por el integrador.
    expect(mockGetDb).toHaveBeenCalledTimes(2);
    expect(mockEnsure).toHaveBeenCalledWith(sqlExecutor, {
      authUserId: "auth-1",
      email: "ana@ejemplo.com",
      displayName: "Ana",
    });
    expect(sqlExecutor).toHaveBeenCalledWith(
      expect.stringContaining("app.accept_invitation"),
      [VALID_TOKEN],
    );
  });

  it("Zod fail (token corto): unknown SIN tocar rate-limit ni DB", async () => {
    const result = await acceptInvitationAction({ token: "corto" });

    expect(result).toEqual({ status: "error", error: { kind: "unknown" } });
    expect(mockEnforce).not.toHaveBeenCalled();
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("rate_limited: deriva retryAfterSeconds y NO toca identity/DB", async () => {
    mockEnforce.mockResolvedValueOnce({
      mode: "enforced",
      success: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
    });

    const result = await acceptInvitationAction({ token: VALID_TOKEN });

    expect(result.status).toBe("error");
    if (result.status === "error" && result.error.kind === "rate_limited") {
      expect(result.error.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(result.error.retryAfterSeconds).toBeLessThanOrEqual(30);
    } else {
      throw new Error("se esperaba error rate_limited");
    }
    expect(mockIdentity).not.toHaveBeenCalled();
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("retryAfterSeconds capeado a 3600 ante resetAt absurdamente lejano", async () => {
    mockEnforce.mockResolvedValueOnce({
      mode: "enforced",
      success: false,
      remaining: 0,
      resetAt: Date.now() + 10_000_000,
    });

    const result = await acceptInvitationAction({ token: VALID_TOKEN });

    expect(result).toEqual({
      status: "error",
      error: { kind: "rate_limited", retryAfterSeconds: 3600 },
    });
  });

  it("retryAfterSeconds piso de 1 ante resetAt en el pasado", async () => {
    mockEnforce.mockResolvedValueOnce({
      mode: "enforced",
      success: false,
      remaining: 0,
      resetAt: Date.now() - 5_000,
    });

    const result = await acceptInvitationAction({ token: VALID_TOKEN });

    expect(result).toEqual({
      status: "error",
      error: { kind: "rate_limited", retryAfterSeconds: 1 },
    });
  });

  it("identity null: unauthenticated sin tocar la DB", async () => {
    mockIdentity.mockResolvedValueOnce(null);

    const result = await acceptInvitationAction({ token: VALID_TOKEN });

    expect(result).toEqual({
      status: "error",
      error: { kind: "unauthenticated" },
    });
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("DEFINER retorna rows vacías (sin slug): unknown", async () => {
    sqlExecutor.mockResolvedValueOnce([]);

    const result = await acceptInvitationAction({ token: VALID_TOKEN });

    expect(result).toEqual({ status: "error", error: { kind: "unknown" } });
  });

  it("ensureAppUser lanza P0002: catch → app_user_missing", async () => {
    mockEnsure.mockRejectedValueOnce({ code: "P0002" });

    const result = await acceptInvitationAction({ token: VALID_TOKEN });

    expect(result).toEqual({
      status: "error",
      error: { kind: "app_user_missing" },
    });
  });

  it("DEFINER lanza P0005: catch → not_found (vía mapAcceptError)", async () => {
    sqlExecutor.mockRejectedValueOnce({ code: "P0005" });

    const result = await acceptInvitationAction({ token: VALID_TOKEN });

    expect(result).toEqual({ status: "error", error: { kind: "not_found" } });
  });

  it("DEFINER lanza P0007: catch → already_used", async () => {
    sqlExecutor.mockRejectedValueOnce({ code: "P0007" });

    const result = await acceptInvitationAction({ token: VALID_TOKEN });

    expect(result).toEqual({ status: "error", error: { kind: "already_used" } });
  });

  it("DEFINER lanza SQLSTATE desconocido: catch → unknown (anti-info-leak)", async () => {
    sqlExecutor.mockRejectedValueOnce(new Error("network down"));

    const result = await acceptInvitationAction({ token: VALID_TOKEN });

    expect(result).toEqual({ status: "error", error: { kind: "unknown" } });
  });
});
