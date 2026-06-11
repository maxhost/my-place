import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { revalidatePath } from "next/cache";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";

import { revokeInvitationAction } from "../revoke-invitation";

// Phase 2.C.3 — branch coverage del wrapper `revokeInvitationAction`.
// Orquestación pura (Zod gate → DEFINER → revalidatePath → map error). Sin
// rate limit (la action no lo aplica). Mock del integrador + `next/cache`. El
// DEFINER vivo (`app.revoke_invitation`, DELETE físico) se verifica en
// integration/smoke, NO acá.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/shared/lib/db-for-request", () => ({
  getAuthenticatedDbForRequest: vi.fn(),
}));

const mockRevalidate = vi.mocked(revalidatePath);
const mockGetDb = vi.mocked(getAuthenticatedDbForRequest);

const sqlExecutor = vi.fn();
const VALID_INPUT = { invitationId: "inv-1" };
const PLACE_SLUG = "mi-place";

beforeEach(() => {
  vi.clearAllMocks();
  // La DEFINER retorna void; el caller no usa el row.
  sqlExecutor.mockResolvedValue(undefined);
  mockGetDb.mockImplementation(
    async (fn) => fn(sqlExecutor as never, { sub: "auth-1" }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("revokeInvitationAction (Phase 2.C.3)", () => {
  it("happy path: DEFINER OK → ok + revalidatePath del place", async () => {
    const result = await revokeInvitationAction(VALID_INPUT, PLACE_SLUG);

    expect(result).toEqual({ ok: true });
    expect(sqlExecutor).toHaveBeenCalledWith(
      expect.stringContaining("app.revoke_invitation"),
      ["inv-1"],
    );
    expect(mockRevalidate).toHaveBeenCalledWith(
      "/place/mi-place/settings/members",
    );
  });

  it("Zod fail (invitationId vacío): generic SIN tocar la DB", async () => {
    const result = await revokeInvitationAction(
      { invitationId: "" },
      PLACE_SLUG,
    );

    expect(result).toEqual({ ok: false, error: "generic" });
    expect(mockGetDb).not.toHaveBeenCalled();
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it("DEFINER lanza 'invitation not found': catch → not_found", async () => {
    sqlExecutor.mockRejectedValueOnce(new Error("invitation not found"));

    const result = await revokeInvitationAction(VALID_INPUT, PLACE_SLUG);

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it("DEFINER lanza 'already-accepted': catch → already_accepted", async () => {
    sqlExecutor.mockRejectedValueOnce(
      new Error("cannot revoke already-accepted invitation"),
    );

    const result = await revokeInvitationAction(VALID_INPUT, PLACE_SLUG);

    expect(result).toEqual({ ok: false, error: "already_accepted" });
  });

  it("DEFINER lanza 28000: catch → unauthorized", async () => {
    sqlExecutor.mockRejectedValueOnce({ code: "28000" });

    const result = await revokeInvitationAction(VALID_INPUT, PLACE_SLUG);

    expect(result).toEqual({ ok: false, error: "unauthorized" });
  });

  it("DEFINER lanza 'not an owner': catch → not_owner", async () => {
    sqlExecutor.mockRejectedValueOnce(
      new Error("caller is not an owner of this place"),
    );

    const result = await revokeInvitationAction(VALID_INPUT, PLACE_SLUG);

    expect(result).toEqual({ ok: false, error: "not_owner" });
  });

  it("DEFINER lanza error desconocido: catch → generic (anti-info-leak)", async () => {
    sqlExecutor.mockRejectedValueOnce(new Error("network down"));

    const result = await revokeInvitationAction(VALID_INPUT, PLACE_SLUG);

    expect(result).toEqual({ ok: false, error: "generic" });
  });
});
