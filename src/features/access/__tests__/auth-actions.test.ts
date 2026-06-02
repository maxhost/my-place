import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { enforceRateLimit, getRequestIp } from "@/shared/lib/rate-limit";
import { getAuth } from "@/shared/lib/auth";

import { loginAction, signUpAccountAction } from "../auth-actions";

// Phase 2.C.2 — branch coverage de `loginAction` / `signUpAccountAction`. El
// wiring vivo del SDK Neon Auth + `next/headers` (IP) se mockean: las actions
// son orquestación pura (Zod gate → rate limit → SDK → traducción a
// `AccessResult`). El SDK real se verifica en preview Vercel (comment en
// `auth-actions.ts:50-59`), NO acá. Acá cubrimos exclusivamente las ramas TS:
// Zod fail, rate_limited (+ derivación de retryAfterSeconds), error del SDK,
// `data.token` falsy (signup), throw del SDK, y happy path.

const signInEmail = vi.fn();
const signUpEmail = vi.fn();

vi.mock("@/shared/lib/auth", () => ({ getAuth: vi.fn() }));
vi.mock("@/shared/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  getRequestIp: vi.fn(),
}));

const mockGetAuth = vi.mocked(getAuth);
const mockEnforce = vi.mocked(enforceRateLimit);
const mockGetIp = vi.mocked(getRequestIp);

// Gate "abierto" por defecto: limiter activo, request permitida.
function allowRateLimit() {
  mockEnforce.mockResolvedValue({
    mode: "enforced",
    success: true,
    remaining: 4,
    resetAt: 0,
  });
}

const VALID_EMAIL = "ana@ejemplo.com";
const VALID_PASSWORD = "supersecreta";
const VALID_NAME = "Ana";

beforeEach(() => {
  signInEmail.mockReset();
  signUpEmail.mockReset();
  mockGetAuth.mockReset();
  mockEnforce.mockReset();
  mockGetIp.mockReset();

  mockGetIp.mockResolvedValue("203.0.113.7");
  mockGetAuth.mockReturnValue({
    signIn: { email: signInEmail },
    signUp: { email: signUpEmail },
  } as unknown as ReturnType<typeof getAuth>);
  allowRateLimit();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loginAction (Phase 2.C.2)", () => {
  it("happy path: credenciales OK → status ok + propaga email/password parseados", async () => {
    signInEmail.mockResolvedValueOnce({ error: null });

    const result = await loginAction(VALID_EMAIL, VALID_PASSWORD);

    expect(result).toEqual({ status: "ok" });
    expect(signInEmail).toHaveBeenCalledWith({
      email: VALID_EMAIL,
      password: VALID_PASSWORD,
    });
  });

  it("Zod fail (email malformado): login_failed SIN tocar rate-limit ni el SDK", async () => {
    const result = await loginAction("no-es-email", VALID_PASSWORD);

    expect(result).toEqual({ status: "login_failed" });
    expect(mockEnforce).not.toHaveBeenCalled();
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it("Zod fail (password <8): login_failed sin tocar el SDK", async () => {
    const result = await loginAction(VALID_EMAIL, "corta");

    expect(result).toEqual({ status: "login_failed" });
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it("rate_limited: deriva retryAfterSeconds y NO llama al SDK", async () => {
    mockEnforce.mockResolvedValueOnce({
      mode: "enforced",
      success: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
    });

    const result = await loginAction(VALID_EMAIL, VALID_PASSWORD);

    expect(result.status).toBe("rate_limited");
    if (result.status === "rate_limited") {
      expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(30);
    }
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it("retryAfterSeconds capeado a 3600 ante resetAt absurdamente lejano", async () => {
    mockEnforce.mockResolvedValueOnce({
      mode: "enforced",
      success: false,
      remaining: 0,
      resetAt: Date.now() + 10_000_000,
    });

    const result = await loginAction(VALID_EMAIL, VALID_PASSWORD);

    expect(result).toEqual({ status: "rate_limited", retryAfterSeconds: 3600 });
  });

  it("retryAfterSeconds piso de 1 ante resetAt en el pasado", async () => {
    mockEnforce.mockResolvedValueOnce({
      mode: "enforced",
      success: false,
      remaining: 0,
      resetAt: Date.now() - 5_000,
    });

    const result = await loginAction(VALID_EMAIL, VALID_PASSWORD);

    expect(result).toEqual({ status: "rate_limited", retryAfterSeconds: 1 });
  });

  it("SDK retorna { error }: login_failed (sin doxxear el detalle)", async () => {
    signInEmail.mockResolvedValueOnce({ error: { message: "bad creds" } });

    const result = await loginAction(VALID_EMAIL, VALID_PASSWORD);

    expect(result).toEqual({ status: "login_failed" });
  });

  it("SDK lanza: el catch colapsa a login_failed", async () => {
    signInEmail.mockRejectedValueOnce(new Error("network down"));

    const result = await loginAction(VALID_EMAIL, VALID_PASSWORD);

    expect(result).toEqual({ status: "login_failed" });
  });
});

describe("signUpAccountAction (Phase 2.C.2)", () => {
  const creds = {
    email: VALID_EMAIL,
    password: VALID_PASSWORD,
    displayName: VALID_NAME,
  };

  it("happy path: data.token presente → ok + propaga email/password/name", async () => {
    signUpEmail.mockResolvedValueOnce({
      data: { token: "sess_opaco" },
      error: null,
    });

    const result = await signUpAccountAction(creds);

    expect(result).toEqual({ status: "ok" });
    expect(signUpEmail).toHaveBeenCalledWith({
      email: VALID_EMAIL,
      password: VALID_PASSWORD,
      name: VALID_NAME,
    });
  });

  it("Zod fail (email malformado): signup_failed sin tocar rate-limit ni SDK", async () => {
    const result = await signUpAccountAction({ ...creds, email: "x" });

    expect(result).toEqual({ status: "signup_failed" });
    expect(mockEnforce).not.toHaveBeenCalled();
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it("Zod fail (displayName sólo whitespace → vacío post-trim): signup_failed", async () => {
    const result = await signUpAccountAction({ ...creds, displayName: "   " });

    expect(result).toEqual({ status: "signup_failed" });
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it("displayName se trimmea antes de pasar al SDK", async () => {
    signUpEmail.mockResolvedValueOnce({
      data: { token: "sess_opaco" },
      error: null,
    });

    await signUpAccountAction({ ...creds, displayName: "  Ana  " });

    expect(signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Ana" }),
    );
  });

  it("rate_limited: retryAfterSeconds derivado, sin tocar el SDK", async () => {
    mockEnforce.mockResolvedValueOnce({
      mode: "enforced",
      success: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    });

    const result = await signUpAccountAction(creds);

    expect(result.status).toBe("rate_limited");
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it("SDK retorna { error }: signup_failed", async () => {
    signUpEmail.mockResolvedValueOnce({
      data: { token: "x" },
      error: { message: "email ya registrado" },
    });

    const result = await signUpAccountAction(creds);

    expect(result).toEqual({ status: "signup_failed" });
  });

  it("data.token falsy (undefined): signup_failed aunque no haya error", async () => {
    signUpEmail.mockResolvedValueOnce({ data: { token: undefined }, error: null });

    const result = await signUpAccountAction(creds);

    expect(result).toEqual({ status: "signup_failed" });
  });

  it("data null: signup_failed (optional chaining `data?.token`)", async () => {
    signUpEmail.mockResolvedValueOnce({ data: null, error: null });

    const result = await signUpAccountAction(creds);

    expect(result).toEqual({ status: "signup_failed" });
  });

  it("SDK lanza: el catch colapsa a signup_failed", async () => {
    signUpEmail.mockRejectedValueOnce(new Error("network down"));

    const result = await signUpAccountAction(creds);

    expect(result).toEqual({ status: "signup_failed" });
  });
});
