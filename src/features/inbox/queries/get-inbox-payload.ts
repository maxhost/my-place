import type { SqlExecutor } from "@/shared/lib/db";
import {
  type InboxPayload,
  type InboxPlace,
  type PlaceStatus,
  PLACE_STATUSES,
} from "../domain/inbox-payload";

// Wrapper de la stored function `app.get_inbox_payload()` (migration 0005).
// El page del Hub invoca este wrapper dentro de `getAuthenticatedDb(token, …)`
// (ADR-0006/0011) — el `SqlExecutor` ya viene con los claims del caller
// inyectados tx-local; la function corre SECURITY INVOKER bajo esa RLS.
//
// La function devuelve JSONB con shape snake_case (theme_accent, is_owner,
// joined_at, status como string). Este wrapper hace la conversión final a
// TypeScript: camelCase + tipos (Date para fechas, PlaceStatus union para el
// status). NUNCA se inventan valores: si el status no matchea el union, lanza
// (signal claro de drift entre la DB y el código — fail-loud, no fail-silent).

/**
 * Shape crudo que devuelve la stored function (JSONB). El wrapper lo valida
 * y lo convierte a `InboxPayload`. Se exporta sólo para tests del wrapper.
 */
export type RawInboxPayload = {
  displayName: string | null;
  places: RawInboxPlace[];
};

export type RawInboxPlace = {
  id: string;
  slug: string;
  name: string;
  theme_accent: string | null;
  status: string;
  is_owner: boolean;
  joined_at: string;
};

function isPlaceStatus(value: string): value is PlaceStatus {
  return (PLACE_STATUSES as readonly string[]).includes(value);
}

/**
 * Parsea el JSON crudo de la stored function al shape canónico TS. Pura, sin
 * I/O — testable de forma aislada (smoke tests del slice).
 */
export function parseInboxPayload(raw: RawInboxPayload): InboxPayload {
  return {
    displayName: raw.displayName,
    places: raw.places.map(parseInboxPlace),
  };
}

function parseInboxPlace(raw: RawInboxPlace): InboxPlace {
  if (!isPlaceStatus(raw.status)) {
    // Drift entre el enum de la DB y el union TS — fail-loud. Si esto pasa
    // es señal de que se agregó un valor al enum en una migration sin
    // actualizar `PlaceStatus` (que deriva de `placeSubscriptionStatus.
    // enumValues` — debería propagarse automáticamente al regenerar el
    // schema con drizzle-kit).
    throw new Error(`PlaceStatus desconocido recibido de la DB: ${raw.status}`);
  }
  const memberSince = new Date(raw.joined_at);
  if (Number.isNaN(memberSince.getTime())) {
    throw new Error(`joined_at inválido recibido de la DB: ${raw.joined_at}`);
  }
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    themeAccent: raw.theme_accent,
    status: raw.status,
    isOwner: raw.is_owner,
    memberSince,
  };
}

/**
 * Invoca `app.get_inbox_payload()` y retorna el shape canónico TS. El
 * `executor` viene de `getAuthenticatedDb(token, async (sql) => …)`; la RLS
 * + el claim del caller hacen el aislamiento (ADR-0021).
 */
export async function getInboxPayload(executor: SqlExecutor): Promise<InboxPayload> {
  const rows = await executor("SELECT app.get_inbox_payload() AS payload");
  const raw = (rows[0]?.payload ?? null) as RawInboxPayload | null;
  if (raw === null) {
    // No debería pasar (la function siempre retorna jsonb_build_object), pero
    // si por error de driver no llega payload, fallar explícito.
    throw new Error("app.get_inbox_payload() devolvió payload vacío");
  }
  return parseInboxPayload(raw);
}
