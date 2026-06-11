import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tests del wrapper `enforceRateLimit` con mocks de `@upstash/ratelimit` +
// `@upstash/redis`. NO hace network calls — todo in-memory.
//
// Cobertura:
//   - Skip en dev sin creds (warn loggeado).
//   - Throw en prod sin creds (fail-loud).
//   - Enforce normal con creds: success + bloqueo + resetAt propagado.
//   - Singleton: ensureLimiters NO re-construye Ratelimit entre calls.

const limitMock = vi.fn();
const RatelimitCtor = vi.fn();
const RedisCtor = vi.fn();

vi.mock("@upstash/ratelimit", () => {
  function MockRatelimit(this: { limit: typeof limitMock }, opts: unknown) {
    RatelimitCtor(opts);
    this.limit = limitMock;
  }
  return {
    Ratelimit: Object.assign(MockRatelimit, {
      slidingWindow: (tokens: number, window: string) => ({
        marker: "slidingWindow",
        tokens,
        window,
      }),
    }),
  };
});

vi.mock("@upstash/redis", () => {
  function MockRedis(opts: unknown) {
    RedisCtor(opts);
  }
  return { Redis: MockRedis };
});

// Import despues del mock para que la captura aplique.
async function loadModule() {
  return await import("../index");
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  limitMock.mockReset();
  RatelimitCtor.mockReset();
  RedisCtor.mockReset();
  const env = process.env as Record<string, string | undefined>;
  delete env.UPSTASH_REDIS_REST_URL;
  delete env.UPSTASH_REDIS_REST_TOKEN;
  delete env.NODE_ENV;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("enforceRateLimit — dev sin creds", () => {
  it("retorna mode='skipped', success=true y NO construye limiters", async () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mod = await loadModule();
    const r = await mod.enforceRateLimit("login", "1.2.3.4");

    expect(r).toEqual({ mode: "skipped", success: true });
    expect(RedisCtor).not.toHaveBeenCalled();
    expect(RatelimitCtor).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("rate-limit");

    warnSpy.mockRestore();
  });

  it("logea warn UNA SOLA vez aunque se llame múltiple", async () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mod = await loadModule();
    await mod.enforceRateLimit("login", "1.2.3.4");
    await mod.enforceRateLimit("signup", "1.2.3.4");
    await mod.enforceRateLimit("login", "5.6.7.8");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

describe("enforceRateLimit — prod sin creds", () => {
  it("throw con mensaje claro al primer call", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";

    const mod = await loadModule();
    await expect(mod.enforceRateLimit("login", "1.2.3.4")).rejects.toThrow(
      /Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN in production/,
    );
  });

  it("throw cuando sólo falta el TOKEN", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.UPSTASH_REDIS_REST_URL = "https://x.upstash.io";

    const mod = await loadModule();
    await expect(mod.enforceRateLimit("login", "1.2.3.4")).rejects.toThrow(
      /Missing UPSTASH/,
    );
  });

  it("throw cuando sólo falta el URL", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.UPSTASH_REDIS_REST_TOKEN = "secret";

    const mod = await loadModule();
    await expect(mod.enforceRateLimit("login", "1.2.3.4")).rejects.toThrow(
      /Missing UPSTASH/,
    );
  });
});

describe("enforceRateLimit — con creds (cualquier NODE_ENV)", () => {
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = "https://x.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "secret";
  });

  it("construye 1 Redis client + 1 Ratelimit por kind al primer call", async () => {
    limitMock.mockResolvedValue({
      success: true,
      remaining: 4,
      reset: 1_700_000_000_000,
    });

    const mod = await loadModule();
    await mod.enforceRateLimit("login", "1.2.3.4");

    expect(RedisCtor).toHaveBeenCalledTimes(1);
    expect(RedisCtor).toHaveBeenCalledWith({
      url: "https://x.upstash.io",
      token: "secret",
    });
    // 10 RateLimitKinds = 10 instancias Ratelimit
    expect(RatelimitCtor).toHaveBeenCalledTimes(10);
  });

  it("NO re-construye entre calls (singleton)", async () => {
    limitMock.mockResolvedValue({
      success: true,
      remaining: 4,
      reset: 1_700_000_000_000,
    });

    const mod = await loadModule();
    await mod.enforceRateLimit("login", "1.2.3.4");
    await mod.enforceRateLimit("signup", "5.6.7.8");
    await mod.enforceRateLimit("login", "9.10.11.12");

    expect(RedisCtor).toHaveBeenCalledTimes(1);
    expect(RatelimitCtor).toHaveBeenCalledTimes(10);
  });

  it("retorna mode='enforced', success=true cuando el limiter permite", async () => {
    limitMock.mockResolvedValue({
      success: true,
      remaining: 4,
      reset: 1_700_000_000_000,
    });

    const mod = await loadModule();
    const r = await mod.enforceRateLimit("login", "1.2.3.4");

    expect(r).toEqual({
      mode: "enforced",
      success: true,
      remaining: 4,
      resetAt: 1_700_000_000_000,
    });
  });

  it("retorna mode='enforced', success=false cuando el limiter bloquea", async () => {
    limitMock.mockResolvedValue({
      success: false,
      remaining: 0,
      reset: 1_700_000_000_000,
    });

    const mod = await loadModule();
    const r = await mod.enforceRateLimit("login", "1.2.3.4");

    expect(r).toEqual({
      mode: "enforced",
      success: false,
      remaining: 0,
      resetAt: 1_700_000_000_000,
    });
  });

  it("prefija identifier con el kind (anti-cross-kind collision)", async () => {
    limitMock.mockResolvedValue({
      success: true,
      remaining: 1,
      reset: 0,
    });

    const mod = await loadModule();
    await mod.enforceRateLimit("login", "1.2.3.4");

    expect(limitMock).toHaveBeenCalledWith("login:1.2.3.4");
  });
});

describe("RATE_LIMITS — kinds de costo (S2 hardening post-review)", () => {
  it("incluye los 4 kinds nuevos: LLM, creación de place y Vercel API", async () => {
    const { RATE_LIMITS } = await import("../config");
    expect(Object.keys(RATE_LIMITS)).toEqual(
      expect.arrayContaining([
        "suggest_style",
        "create_place",
        "register_domain",
        "domain_status_poll",
      ]),
    );
  });

  it("domain_status_poll tolera el auto-refresh 30s de la page pending (≥2/min sostenido)", async () => {
    // El sub-componente AutoRefresh de domain-section-pending refresca cada
    // 30s → 2 polls/min por tab. El límite debe dejar margen para 2-3 tabs
    // del mismo owner sin bloquear (si bloquea, la UX degrada calma al
    // notice vercelUnavailable — pero no debe pasar en uso legítimo).
    const { RATE_LIMITS } = await import("../config");
    const cfg = RATE_LIMITS.domain_status_poll;
    const [n, unit] = cfg.window.split(" ");
    const windowMinutes = unit === "m" ? Number(n) : Number(n) / 60;
    expect(cfg.tokens / windowMinutes).toBeGreaterThanOrEqual(4);
  });
});
