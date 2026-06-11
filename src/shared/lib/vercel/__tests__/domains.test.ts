import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDomain, getDomainStatus, removeDomain } from "../domains";

// Tests del wrapper `shared/lib/vercel/domains` (S2/Agent C de
// custom-domain V1, ADR-0026). Cubren el contrato público (3 funciones +
// discriminated union `VercelResult<T>`), el shape real validado contra
// docs Vercel REST (POST `/v10/projects/{id}/domains`, GET/DELETE
// `/v9/projects/{id}/domains/{domain}`) y los seis `VercelErrorReason`
// que el slice de settings consume. Patrón: `vi.stubGlobal("fetch", …)`
// + `vi.stubEnv("VERCEL_API_TOKEN", …)`; cada test re-mockea la
// response a su gusto. Sin red real, sin Vercel real.

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

describe("addDomain — POST /v10/projects/{id}/domains", () => {
  it("200 con verified=true → ok + dnsRecords vacío", async () => {
    mockFetchResponse(200, {
      name: "ejemplo.com",
      apexName: "ejemplo.com",
      projectId: "prj_test_mock",
      verified: true,
      createdAt: 1716240000000,
      updatedAt: 1716240000000,
    });

    const result = await addDomain("ejemplo.com");

    expect(result).toEqual({
      ok: true,
      data: { domain: "ejemplo.com", verified: true, dnsRecords: [] },
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.vercel.com/v10/projects/prj_test_mock/domains",
    );
    expect(init.method).toBe("POST");
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer test-token-mock");
    expect(
      (init.headers as Record<string, string>)["Content-Type"],
    ).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ name: "ejemplo.com" });
  });

  it("200 con verified=false → ok + dnsRecords populados desde `verification`", async () => {
    mockFetchResponse(200, {
      name: "comunidad.mi-marca.com",
      apexName: "mi-marca.com",
      projectId: "prj_test_mock",
      verified: false,
      verification: [
        {
          type: "TXT",
          domain: "_vercel.mi-marca.com",
          value: "vc-domain-verify=...",
          reason: "pending_domain_verification",
        },
        {
          type: "CNAME",
          domain: "comunidad.mi-marca.com",
          value: "cname.vercel-dns.com",
          reason: "pending_domain_verification",
        },
      ],
      createdAt: 1716240000000,
      updatedAt: 1716240000000,
    });

    const result = await addDomain("comunidad.mi-marca.com");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.verified).toBe(false);
    expect(result.data.dnsRecords).toEqual([
      {
        type: "TXT",
        name: "_vercel.mi-marca.com",
        value: "vc-domain-verify=...",
        domain: "_vercel.mi-marca.com",
        reason: "pending_domain_verification",
      },
      {
        type: "CNAME",
        name: "comunidad.mi-marca.com",
        value: "cname.vercel-dns.com",
        domain: "comunidad.mi-marca.com",
        reason: "pending_domain_verification",
      },
    ]);
  });

  it("409 → domain_already_in_use", async () => {
    mockFetchResponse(409, {
      error: {
        code: "domain_already_in_use",
        message: "Cannot add domain since it's already in use by another project.",
      },
    });

    const result = await addDomain("ya-usado.com");

    expect(result).toEqual({ ok: false, reason: "domain_already_in_use" });
  });

  it("422 → vercel_error", async () => {
    mockFetchResponse(422, { error: { code: "invalid_domain" } });

    const result = await addDomain("invalido");

    expect(result).toEqual({ ok: false, reason: "vercel_error" });
  });
});

describe("getDomainStatus — GET /v9/projects/{id}/domains/{domain}", () => {
  it("200 valid → ok + parsed", async () => {
    mockFetchResponse(200, {
      name: "ejemplo.com",
      apexName: "ejemplo.com",
      projectId: "prj_test_mock",
      verified: true,
      createdAt: 1716240000000,
      updatedAt: 1716240000000,
    });

    const result = await getDomainStatus("ejemplo.com");

    expect(result).toEqual({
      ok: true,
      data: { domain: "ejemplo.com", verified: true, dnsRecords: [] },
    });

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.vercel.com/v9/projects/prj_test_mock/domains/ejemplo.com",
    );
    expect(init.method).toBe("GET");
  });

  it("encodea el componente domain en la URL", async () => {
    mockFetchResponse(200, {
      name: "sub.dom.com",
      apexName: "dom.com",
      projectId: "prj_test_mock",
      verified: true,
    });

    await getDomainStatus("sub.dom.com");

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
    ];
    expect(url).toBe(
      "https://api.vercel.com/v9/projects/prj_test_mock/domains/sub.dom.com",
    );
  });

  it("404 → not_configured", async () => {
    mockFetchResponse(404, { error: { code: "not_found" } });

    const result = await getDomainStatus("inexistente.com");

    expect(result).toEqual({ ok: false, reason: "not_configured" });
  });

  it("401 → unauthorized", async () => {
    mockFetchResponse(401, { error: { code: "forbidden" } });

    const result = await getDomainStatus("x.com");

    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("429 → rate_limited", async () => {
    mockFetchResponse(429, { error: { code: "too_many_requests" } });

    const result = await getDomainStatus("x.com");

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("500 → vercel_error", async () => {
    mockFetchResponse(500, { error: { code: "internal_server_error" } });

    const result = await getDomainStatus("x.com");

    expect(result).toEqual({ ok: false, reason: "vercel_error" });
  });

  it("fetch rejected (network) → network", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError("fetch failed"),
    );

    const result = await getDomainStatus("x.com");

    expect(result).toEqual({ ok: false, reason: "network" });
  });

  it("response malformada (Zod parse falla) → vercel_error", async () => {
    mockFetchResponse(200, { foo: "bar" });

    const result = await getDomainStatus("x.com");

    expect(result).toEqual({ ok: false, reason: "vercel_error" });
  });
});

describe("removeDomain — DELETE /v9/projects/{id}/domains/{domain}", () => {
  it("200 → ok + data vacío", async () => {
    mockFetchResponse(200, {});

    const result = await removeDomain("ejemplo.com");

    expect(result).toEqual({ ok: true, data: {} });

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.vercel.com/v9/projects/prj_test_mock/domains/ejemplo.com",
    );
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token-mock",
    );
  });

  it("preserva `uid` si Vercel lo devuelve (forward-compat)", async () => {
    mockFetchResponse(200, { uid: "dom_abc123" });

    const result = await removeDomain("ejemplo.com");

    expect(result).toEqual({ ok: true, data: { uid: "dom_abc123" } });
  });

  it("404 → not_configured", async () => {
    mockFetchResponse(404, { error: { code: "not_found" } });

    const result = await removeDomain("inexistente.com");

    expect(result).toEqual({ ok: false, reason: "not_configured" });
  });
});

describe("env vars missing", () => {
  it("VERCEL_API_TOKEN ausente → vercel_error sin throw", async () => {
    // Post Phase 0.E (ADR-0047): el wrapper usa log.warn (semánticamente
    // correcto: missing creds es warning, no error), que internamente llama
    // a console.warn.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.unstubAllEnvs();
    // re-stubeamos PROJECT_ID solo, dejando TOKEN sin definir
    vi.stubEnv("VERCEL_PROJECT_ID", "prj_test_mock");

    const result = await getDomainStatus("x.com");

    expect(result).toEqual({ ok: false, reason: "vercel_error" });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("VERCEL_PROJECT_ID ausente → vercel_error sin throw", async () => {
    // Post Phase 0.E (ADR-0047): ver test anterior.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.unstubAllEnvs();
    vi.stubEnv("VERCEL_API_TOKEN", "test-token-mock");

    const result = await addDomain("x.com");

    expect(result).toEqual({ ok: false, reason: "vercel_error" });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("timeout (S2 hardening post-review)", () => {
  // Sin signal, un fetch a api.vercel.com colgado retiene el Server Action
  // hasta el timeout de la función (300s) — el owner ve spinner infinito.
  // Cada fetch lleva AbortSignal.timeout; el abort cae en el catch existente
  // y mapea a `network` (misma UX que un drop de red).
  function lastFetchInit(): RequestInit {
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    return calls[calls.length - 1][1] as RequestInit;
  }

  it("addDomain pasa un AbortSignal al fetch", async () => {
    mockFetchResponse(200, { name: "x.com", verified: true });
    await addDomain("x.com");
    expect(lastFetchInit().signal).toBeInstanceOf(AbortSignal);
  });

  it("getDomainStatus pasa un AbortSignal al fetch", async () => {
    mockFetchResponse(200, { name: "x.com", verified: true });
    await getDomainStatus("x.com");
    expect(lastFetchInit().signal).toBeInstanceOf(AbortSignal);
  });

  it("removeDomain pasa un AbortSignal al fetch", async () => {
    mockFetchResponse(200, {});
    await removeDomain("x.com");
    expect(lastFetchInit().signal).toBeInstanceOf(AbortSignal);
  });

  it("abort por timeout (TimeoutError) → network", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DOMException("The operation timed out.", "TimeoutError"),
    );
    const result = await getDomainStatus("x.com");
    expect(result).toEqual({ ok: false, reason: "network" });
  });
});
