import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pool } from "@/db/client";

import { lookupInvitationPreview } from "../invitation-preview-lookup";

// Feature E — Invite Accept Flow V1.2 · Sesión B (ADR-0046 §D2). Tests del
// wrapper TS sobre `app.invitation_preview` (migration 0003) para uso en
// `(marketing)/[locale]/login/page.tsx` cuando `?invite={token}` está
// presente — derivar `placeName` + `placeSlug` para el branding apex del
// `<AccessFlow>`. NO duplica `getInvitationMetaByToken` (`_lib/` del invite
// page) porque ese helper hace el cross-place tampering check usando el
// `placeSlug` del URL — el `/login` apex NO tiene placeSlug en su URL, sólo
// el token. Acá la lookup es de pura información (anti-info-leak: cualquier
// drift / token inválido / DB error colapsa a null sin diferenciar la
// causa, defense vs enumeration attack).
//
// Mismo pattern que `custom-domain-by-slug-lookup.test.ts`: mock de pool +
// mock identity de React.cache para que los `it`s no se contaminen entre sí
// vía memoization. La validación de la SQL function `app.invitation_preview`
// vive en `src/db/__tests__/accept-invitation.test.ts` (RLS bypass + payload
// shape + tokens válidos/inválidos). Acá testeamos exclusivamente la
// frontera TS: token shape gate, Zod parse de los 3 campos, fail-safe a
// null ante cualquier error, prefix correcto del log, skip short-circuit
// cuando el token normalizado no cumple shape.

vi.mock("@/db/client", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("react", () => ({
  cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

const mockQuery = vi.mocked(pool.query);

const VALID_TOKEN = "a".repeat(64);

beforeEach(() => {
  mockQuery.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lookupInvitationPreview — frontera TS sobre app.invitation_preview", () => {
  it("happy path: row válida → retorna { placeSlug, placeName, inviteeEmail }", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          place_slug: "nocode-company",
          place_name: "Nocode Company",
          invitee_email: "ana@ejemplo.com",
        },
      ],
    } as never);

    const result = await lookupInvitationPreview(VALID_TOKEN);

    expect(result).toEqual({
      placeSlug: "nocode-company",
      placeName: "Nocode Company",
      inviteeEmail: "ana@ejemplo.com",
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0]!;
    expect(sql).toContain("app.invitation_preview");
    expect(params).toEqual([VALID_TOKEN]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("token shape inválido (no-hex) → null SIN llamar a pool.query", async () => {
    const result = await lookupInvitationPreview("Z".repeat(64));

    expect(result).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("token shape inválido (muy corto, <32 chars) → null sin query", async () => {
    const result = await lookupInvitationPreview("a".repeat(31));
    expect(result).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("token shape inválido (muy largo, >256 chars) → null sin query", async () => {
    const result = await lookupInvitationPreview("a".repeat(257));
    expect(result).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("token vacío / whitespace → null sin query", async () => {
    expect(await lookupInvitationPreview("")).toBeNull();
    expect(await lookupInvitationPreview("   ")).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("token con uppercase → normaliza a lowercase ANTES de query (defense + cache key uniformity)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const upperToken = "A".repeat(64);
    await lookupInvitationPreview(upperToken);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0]!;
    expect(params).toEqual(["a".repeat(64)]);
  });

  it("token con whitespace alrededor: trim ANTES de query", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    await lookupInvitationPreview(`  ${VALID_TOKEN}  `);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0]!;
    expect(params).toEqual([VALID_TOKEN]);
  });

  it("sin filas (token inexistente / vencido / usado) → null, sin log de error", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const result = await lookupInvitationPreview(VALID_TOKEN);

    expect(result).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("DB error → null + log con prefix de DB falló", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection terminated"));

    const result = await lookupInvitationPreview(VALID_TOKEN);

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
    // Post Phase 0.E (ADR-0047): log.error emite JSON structured + err raw.
    const args = vi.mocked(console.error).mock.calls[0]!;
    const payload = JSON.parse(args[0] as string) as Record<string, unknown>;
    expect(payload.scope).toBe("invitation-preview-lookup");
    expect(payload.message).toBe("DB query falló");
    expect(args[1]).toBeInstanceOf(Error);
  });

  it("timeout simulado → null + log con prefix de DB falló", async () => {
    mockQuery.mockRejectedValueOnce(new Error("timeout"));

    const result = await lookupInvitationPreview(VALID_TOKEN);

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("drift: place_slug no-string → null + log de payload inválido", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          place_slug: 123,
          place_name: "Nocode Company",
          invitee_email: "ana@ejemplo.com",
        },
      ],
    } as never);

    const result = await lookupInvitationPreview(VALID_TOKEN);

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
    // Post Phase 0.E (ADR-0047): el wrapper usa log.error que emite JSON
    // structured a console.error.
    const firstArg = vi.mocked(console.error).mock.calls[0]![0] as string;
    const payload = JSON.parse(firstArg) as Record<string, unknown>;
    expect(payload.level).toBe("error");
    expect(payload.scope).toBe("invitation-preview-lookup");
    expect(payload.message).toBe("payload inválido");
  });

  it("drift: place_name vacío → null + log de payload inválido", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          place_slug: "nocode-company",
          place_name: "",
          invitee_email: "ana@ejemplo.com",
        },
      ],
    } as never);

    const result = await lookupInvitationPreview(VALID_TOKEN);

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("drift: invitee_email null → null + log de payload inválido", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          place_slug: "nocode-company",
          place_name: "Nocode Company",
          invitee_email: null,
        },
      ],
    } as never);

    const result = await lookupInvitationPreview(VALID_TOKEN);

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("anti-info-leak: NO diferencia entre causas (token inexistente vs vencido vs usado vs DB error)", async () => {
    // Defense-in-depth: el caller `/login` page no debe poder inferir cuál
    // fue la causa del null para no leakear "este token existe pero
    // venció" a un attacker. Todos los paths colapsan a null sin enum
    // discriminator (a diferencia del helper `getInvitationMetaByToken`
    // del invite page que SÍ distingue para razones de cross-place
    // tampering check específico).
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);
    const r1 = await lookupInvitationPreview(VALID_TOKEN);

    mockQuery.mockRejectedValueOnce(new Error("timeout"));
    const r2 = await lookupInvitationPreview(VALID_TOKEN);

    const r3 = await lookupInvitationPreview("zzz");

    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(r3).toBeNull();
  });
});
