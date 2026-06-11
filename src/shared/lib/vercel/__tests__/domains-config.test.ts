import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDomainConfig } from "../domains-config";

// Tests del wrapper `shared/lib/vercel/domains-config` (V6 endpoint
// `GET /v6/domains/{domain}/config`, ADR-0029). Verifica el contrato
// público `getDomainConfig(domain)` + `VercelResult<DomainConfig>`, el
// shape verificado contra docs Vercel REST 2026-05-22, y la
// normalización de `recommendedIPv4`/`recommendedCNAME` (rank=1
// aplanado a `string[]` independiente de la asimetría del shape
// oficial: IPv4 items tienen `value: string[]`, CNAME items
// `value: string`). Patrón: `vi.stubGlobal("fetch", …)` +
// `vi.stubEnv("VERCEL_API_TOKEN", …)`. Sin red real.

beforeEach(() => {
  vi.stubEnv("VERCEL_API_TOKEN", "test-token-mock");
  vi.stubEnv("VERCEL_PROJECT_ID", "prj_test_mock");
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Mock de una response única `fetch().then(r => r.json())` con status arbitrario. */
function mockFetchResponse(status: number, body: unknown): void {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("getDomainConfig — GET /v6/domains/{domain}/config", () => {
  it("200 con misconfigured=false + configuredBy=CNAME → ok + parsed normalizado", async () => {
    mockFetchResponse(200, {
      configuredBy: "CNAME",
      acceptedChallenges: ["dns-01"],
      recommendedIPv4: [{ rank: 1, value: ["76.76.21.21"] }],
      recommendedCNAME: [{ rank: 1, value: "cname.vercel-dns.com" }],
      misconfigured: false,
    });

    const result = await getDomainConfig("ejemplo.com");

    expect(result).toEqual({
      ok: true,
      data: {
        configuredBy: "CNAME",
        acceptedChallenges: ["dns-01"],
        recommendedIPv4: ["76.76.21.21"],
        recommendedCNAME: ["cname.vercel-dns.com"],
        misconfigured: false,
      },
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.vercel.com/v6/domains/ejemplo.com/config");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token-mock",
    );
  });

  it("200 con misconfigured=true + DNS no apunta → ok + records preservados para que el user configure", async () => {
    mockFetchResponse(200, {
      configuredBy: null,
      acceptedChallenges: [],
      recommendedIPv4: [{ rank: 1, value: ["216.198.79.1"] }],
      recommendedCNAME: [{ rank: 1, value: "cname.vercel-dns.com" }],
      misconfigured: true,
    });

    const result = await getDomainConfig("nocodecompany.co");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.misconfigured).toBe(true);
    expect(result.data.configuredBy).toBeNull();
    expect(result.data.recommendedIPv4).toEqual(["216.198.79.1"]);
    expect(result.data.recommendedCNAME).toEqual(["cname.vercel-dns.com"]);
  });

  it("200 con configuredBy=A → ok + parsed con A record activo", async () => {
    mockFetchResponse(200, {
      configuredBy: "A",
      acceptedChallenges: ["dns-01", "http-01"],
      recommendedIPv4: [{ rank: 1, value: ["76.76.21.21"] }],
      recommendedCNAME: [{ rank: 1, value: "cname.vercel-dns.com" }],
      misconfigured: false,
    });

    const result = await getDomainConfig("apex.com");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.configuredBy).toBe("A");
    expect(result.data.acceptedChallenges).toEqual(["dns-01", "http-01"]);
  });

  it("200 con rank=1 + rank=2 → normaliza extrayendo solo rank=1", async () => {
    mockFetchResponse(200, {
      configuredBy: null,
      acceptedChallenges: ["dns-01"],
      recommendedIPv4: [
        { rank: 1, value: ["216.198.79.1"] },
        { rank: 2, value: ["76.76.21.21"] },
      ],
      recommendedCNAME: [
        { rank: 1, value: "cname.vercel-dns.com" },
        { rank: 2, value: "alt.vercel-dns.com" },
      ],
      misconfigured: true,
    });

    const result = await getDomainConfig("multi-rank.com");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.recommendedIPv4).toEqual(["216.198.79.1"]);
    expect(result.data.recommendedCNAME).toEqual(["cname.vercel-dns.com"]);
  });

  it("200 con IPv4 item de múltiples values en rank=1 → aplana todos los strings", async () => {
    mockFetchResponse(200, {
      configuredBy: "A",
      acceptedChallenges: ["dns-01"],
      recommendedIPv4: [
        { rank: 1, value: ["216.198.79.1", "76.76.21.21"] },
      ],
      recommendedCNAME: [{ rank: 1, value: "cname.vercel-dns.com" }],
      misconfigured: false,
    });

    const result = await getDomainConfig("multi-value.com");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.recommendedIPv4).toEqual([
      "216.198.79.1",
      "76.76.21.21",
    ]);
  });

  it("200 con arrays vacíos en recommendedIPv4/CNAME → ok + arrays vacíos", async () => {
    mockFetchResponse(200, {
      configuredBy: null,
      acceptedChallenges: [],
      recommendedIPv4: [],
      recommendedCNAME: [],
      misconfigured: true,
    });

    const result = await getDomainConfig("empty.com");

    expect(result).toEqual({
      ok: true,
      data: {
        configuredBy: null,
        acceptedChallenges: [],
        recommendedIPv4: [],
        recommendedCNAME: [],
        misconfigured: true,
      },
    });
  });

  it("encodea el componente domain en la URL", async () => {
    mockFetchResponse(200, {
      configuredBy: "CNAME",
      acceptedChallenges: ["dns-01"],
      recommendedIPv4: [{ rank: 1, value: ["76.76.21.21"] }],
      recommendedCNAME: [{ rank: 1, value: "cname.vercel-dns.com" }],
      misconfigured: false,
    });

    await getDomainConfig("sub.dom.com");

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
    ];
    expect(url).toBe("https://api.vercel.com/v6/domains/sub.dom.com/config");
  });

  it("401 → unauthorized", async () => {
    mockFetchResponse(401, { error: { code: "forbidden" } });

    const result = await getDomainConfig("x.com");

    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("404 → not_configured", async () => {
    mockFetchResponse(404, { error: { code: "not_found" } });

    const result = await getDomainConfig("inexistente.com");

    expect(result).toEqual({ ok: false, reason: "not_configured" });
  });

  it("429 → rate_limited", async () => {
    mockFetchResponse(429, { error: { code: "too_many_requests" } });

    const result = await getDomainConfig("x.com");

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("500 → vercel_error", async () => {
    mockFetchResponse(500, { error: { code: "internal_server_error" } });

    const result = await getDomainConfig("x.com");

    expect(result).toEqual({ ok: false, reason: "vercel_error" });
  });

  it("fetch rejected (network) → network", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError("fetch failed"),
    );

    const result = await getDomainConfig("x.com");

    expect(result).toEqual({ ok: false, reason: "network" });
  });

  it("response malformada (Zod parse falla por shape inválido) → vercel_error", async () => {
    mockFetchResponse(200, { foo: "bar" });

    const result = await getDomainConfig("x.com");

    expect(result).toEqual({ ok: false, reason: "vercel_error" });
  });

  it("response con configuredBy inválido (fuera del enum) → vercel_error", async () => {
    mockFetchResponse(200, {
      configuredBy: "INVALID_VALUE",
      acceptedChallenges: ["dns-01"],
      recommendedIPv4: [],
      recommendedCNAME: [],
      misconfigured: false,
    });

    const result = await getDomainConfig("x.com");

    expect(result).toEqual({ ok: false, reason: "vercel_error" });
  });

  it("JSON corrupto (response.json() throws) → vercel_error", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("not-json{[", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await getDomainConfig("x.com");

    expect(result).toEqual({ ok: false, reason: "vercel_error" });
  });

  it("env vars missing → vercel_error sin fetch", async () => {
    // Post Phase 0.E (ADR-0047): el wrapper usa log.warn (semánticamente
    // correcto: missing creds es warning, no error), que internamente llama
    // a console.warn.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.unstubAllEnvs();
    // VERCEL_PROJECT_ID no se usa en este endpoint pero el wrapper lo
    // exige por simetría con el resto (mismo helper readEnvAndHeaders).
    vi.stubEnv("VERCEL_API_TOKEN", "test-token-mock");
    // VERCEL_PROJECT_ID sin definir → vercel_error

    const result = await getDomainConfig("x.com");

    expect(result).toEqual({ ok: false, reason: "vercel_error" });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("getDomainConfig pasa un AbortSignal al fetch (timeout S2 hardening)", async () => {
    // Mismo hazard que los 3 fetch de domains.ts: sin signal, un V6 colgado
    // retiene el lazy poll del page hasta el timeout de la función.
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          configuredBy: null,
          acceptedChallenges: [],
          recommendedIPv4: [],
          recommendedCNAME: [],
          misconfigured: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await getDomainConfig("x.com");

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const init = calls[calls.length - 1][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
