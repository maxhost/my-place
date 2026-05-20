import { describe, expect, it, vi } from "vitest";
import type { SqlExecutor } from "@/shared/lib/db";
import {
  getInboxPayload,
  parseInboxPayload,
  type RawInboxPayload,
} from "../queries/get-inbox-payload";

// Smoke tests del wrapper TS de `app.get_inbox_payload()`. La function ya
// está cubierta end-to-end por `src/db/__tests__/get-inbox-payload.test.ts`
// contra Neon real; estos tests cubren la transformación pura
// snake_case→camelCase + parseo de Date + validación del union PlaceStatus
// (fail-loud ante drift), sin tocar DB.

const VALID_RAW_PLACE = {
  id: "p-1",
  slug: "mi-club",
  name: "Mi Club",
  theme_accent: "#aabbcc",
  status: "ACTIVE",
  is_owner: true,
  joined_at: "2026-01-15T10:30:00.000Z",
};

describe("parseInboxPayload — wrapper TS de app.get_inbox_payload()", () => {
  it("parsea snake_case del DB → camelCase TS, joined_at → Date", () => {
    const raw: RawInboxPayload = {
      displayName: "Ana",
      places: [VALID_RAW_PLACE],
    };
    const parsed = parseInboxPayload(raw);
    expect(parsed.displayName).toBe("Ana");
    expect(parsed.places).toHaveLength(1);
    const place = parsed.places[0];
    expect(place).toMatchObject({
      id: "p-1",
      slug: "mi-club",
      name: "Mi Club",
      themeAccent: "#aabbcc",
      status: "ACTIVE",
      isOwner: true,
    });
    expect(place.memberSince).toBeInstanceOf(Date);
    expect(place.memberSince.toISOString()).toBe("2026-01-15T10:30:00.000Z");
  });

  it("displayName: null se preserva (caso defensivo de la stored function)", () => {
    const raw: RawInboxPayload = { displayName: null, places: [] };
    const parsed = parseInboxPayload(raw);
    expect(parsed.displayName).toBeNull();
    expect(parsed.places).toEqual([]);
  });

  it("themeAccent: null se preserva (place con theme_config aún sin canónico)", () => {
    const raw: RawInboxPayload = {
      displayName: "X",
      places: [{ ...VALID_RAW_PLACE, theme_accent: null }],
    };
    const parsed = parseInboxPayload(raw);
    expect(parsed.places[0].themeAccent).toBeNull();
  });

  it("acepta los 4 valores del enum place_subscription_status", () => {
    const raw: RawInboxPayload = {
      displayName: "X",
      places: [
        { ...VALID_RAW_PLACE, id: "p-a", status: "ACTIVE" },
        { ...VALID_RAW_PLACE, id: "p-b", status: "PAYMENT_PENDING" },
        { ...VALID_RAW_PLACE, id: "p-c", status: "INACTIVATION_PROCESS" },
        { ...VALID_RAW_PLACE, id: "p-d", status: "INACTIVE" },
      ],
    };
    const parsed = parseInboxPayload(raw);
    expect(parsed.places.map((p) => p.status)).toEqual([
      "ACTIVE",
      "PAYMENT_PENDING",
      "INACTIVATION_PROCESS",
      "INACTIVE",
    ]);
  });

  it("lanza si status NO matchea el enum (signal de drift entre DB y TS)", () => {
    const raw: RawInboxPayload = {
      displayName: "X",
      places: [{ ...VALID_RAW_PLACE, status: "FUTURE_STATUS_NOT_IN_TS" }],
    };
    expect(() => parseInboxPayload(raw)).toThrow(/PlaceStatus desconocido/);
  });

  it("lanza si joined_at NO es parseable como Date", () => {
    const raw: RawInboxPayload = {
      displayName: "X",
      places: [{ ...VALID_RAW_PLACE, joined_at: "definitely-not-a-date" }],
    };
    expect(() => parseInboxPayload(raw)).toThrow(/joined_at inválido/);
  });
});

describe("getInboxPayload — wrapper invoca SELECT y devuelve InboxPayload", () => {
  it("ejecuta SELECT app.get_inbox_payload() y mapea el JSONB resultante", async () => {
    const executor = vi.fn(async () => [
      {
        payload: {
          displayName: "Ana",
          places: [VALID_RAW_PLACE],
        } as RawInboxPayload,
      },
    ]) as unknown as SqlExecutor;
    const result = await getInboxPayload(executor);
    expect(executor).toHaveBeenCalledTimes(1);
    // SELECT exacto: nos asegura que el wrapper invoca la función correcta.
    expect((executor as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "SELECT app.get_inbox_payload() AS payload",
    );
    expect(result.displayName).toBe("Ana");
    expect(result.places).toHaveLength(1);
    expect(result.places[0].slug).toBe("mi-club");
  });

  it("lanza si el executor no devuelve payload (driver inesperado)", async () => {
    const executor = vi.fn(async () => []) as unknown as SqlExecutor;
    await expect(getInboxPayload(executor)).rejects.toThrow(/payload vacío/);
  });
});
