import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { revalidatePath } from "next/cache";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";
import { enforceRateLimit, getRequestIp } from "@/shared/lib/rate-limit";

import { createInvitationAction } from "../create-invitation";

// Phase 2.C.3 — branch coverage del wrapper `createInvitationAction`.
// Orquestación pura (Zod gate con triage de issue → rate limit por IP+place →
// DEFINER → revalidatePath → map error). Mock del integrador
// `getAuthenticatedDbForRequest`, el rate limiter y `next/cache`. El DEFINER
// vivo (`app.create_invitation`) se verifica en integration/smoke, NO acá.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/shared/lib/db-for-request", () => ({
  getAuthenticatedDbForRequest: vi.fn(),
}));
vi.mock("@/shared/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  getRequestIp: vi.fn(),
}));

const mockRevalidate = vi.mocked(revalidatePath);
const mockGetDb = vi.mocked(getAuthenticatedDbForRequest);
const mockEnforce = vi.mocked(enforceRateLimit);
const mockGetIp = vi.mocked(getRequestIp);

const sqlExecutor = vi.fn();
const VALID_INPUT = {
  placeId: "place-1",
  email: "ana@ejemplo.com",
  expiresInDays: 7,
};
const PLACE_SLUG = "mi-place";

function allowRateLimit() {
  mockEnforce.mockResolvedValue({
    mode: "enforced",
    success: true,
    remaining: 29,
    resetAt: 0,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetIp.mockResolvedValue("203.0.113.7");
  allowRateLimit();
  sqlExecutor.mockResolvedValue([
    { payload: { invitation_id: "inv-1", token: "tok-1" } },
  ]);
  mockGetDb.mockImplementation(
    async (fn) => fn(sqlExecutor as never, { sub: "auth-1" }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createInvitationAction (Phase 2.C.3)", () => {
  it("happy path: DEFINER retorna payload → ok + revalidatePath del place", async () => {
    const result = await createInvitationAction(VALID_INPUT, PLACE_SLUG);

    expect(result).toEqual({
      ok: true,
      invitationId: "inv-1",
      token: "tok-1",
    });
    expect(mockEnforce).toHaveBeenCalledWith(
      "create_invitation",
      "203.0.113.7:place-1",
    );
    expect(sqlExecutor).toHaveBeenCalledWith(
      expect.stringContaining("app.create_invitation"),
      expect.arrayContaining(["place-1", "ana@ejemplo.com"]),
    );
    expect(mockRevalidate).toHaveBeenCalledWith("/mi-place/settings/members");
  });

  it("Zod fail (email inválido): invalid_email SIN tocar rate-limit ni DB", async () => {
    const result = await createInvitationAction(
      { ...VALID_INPUT, email: "no-es-email" },
      PLACE_SLUG,
    );

    expect(result).toEqual({ ok: false, error: "invalid_email" });
    expect(mockEnforce).not.toHaveBeenCalled();
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("Zod fail (expiresInDays fuera de rango): invalid_expires", async () => {
    const result = await createInvitationAction(
      { ...VALID_INPUT, expiresInDays: 0 },
      PLACE_SLUG,
    );

    expect(result).toEqual({ ok: false, error: "invalid_expires" });
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("Zod fail (otro campo, placeId vacío): generic", async () => {
    const result = await createInvitationAction(
      { ...VALID_INPUT, placeId: "" },
      PLACE_SLUG,
    );

    expect(result).toEqual({ ok: false, error: "generic" });
  });

  it("rate_limited: NO toca la DB", async () => {
    mockEnforce.mockResolvedValueOnce({
      mode: "enforced",
      success: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    });

    const result = await createInvitationAction(VALID_INPUT, PLACE_SLUG);

    expect(result).toEqual({ ok: false, error: "rate_limited" });
    expect(mockGetDb).not.toHaveBeenCalled();
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it("DEFINER retorna sin payload: generic (sin revalidatePath)", async () => {
    sqlExecutor.mockResolvedValueOnce([]);

    const result = await createInvitationAction(VALID_INPUT, PLACE_SLUG);

    expect(result).toEqual({ ok: false, error: "generic" });
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it("DEFINER lanza 'not an owner': catch → not_owner", async () => {
    sqlExecutor.mockRejectedValueOnce(
      new Error("caller is not an owner of this place"),
    );

    const result = await createInvitationAction(VALID_INPUT, PLACE_SLUG);

    expect(result).toEqual({ ok: false, error: "not_owner" });
  });

  it("DEFINER lanza 28000: catch → unauthorized", async () => {
    sqlExecutor.mockRejectedValueOnce({ code: "28000" });

    const result = await createInvitationAction(VALID_INPUT, PLACE_SLUG);

    expect(result).toEqual({ ok: false, error: "unauthorized" });
  });

  it("DEFINER lanza error desconocido: catch → generic (anti-info-leak)", async () => {
    sqlExecutor.mockRejectedValueOnce(new Error("network down"));

    const result = await createInvitationAction(VALID_INPUT, PLACE_SLUG);

    expect(result).toEqual({ ok: false, error: "generic" });
  });
});
