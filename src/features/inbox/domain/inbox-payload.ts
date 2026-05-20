// Dominio del payload del Hub (sesión 2 de docs/features/inbox/). Los tipos
// expuestos al resto del slice y a sus consumers vía `public.ts`. La fuente
// de verdad del shape es la stored function `app.get_inbox_payload()`
// (migration 0005); este módulo declara la versión TypeScript camelCase +
// typed (Date, status union) que el wrapper construye.
//
// Convención: la DB devuelve snake_case (theme_accent, is_owner, joined_at)
// y status como string libre del enum `place_subscription_status`; el wrapper
// convierte a camelCase, parsea joined_at → Date y castea status → union
// literal (`PlaceStatus`) — derivada del pgEnum canónico para que cualquier
// cambio del enum en la DB rompa typecheck acá antes de llegar a runtime.

import { placeSubscriptionStatus } from "@/db/schema";

/**
 * Lista cerrada de valores válidos del enum `place_subscription_status`.
 * Derivada del pgEnum canónico (drizzle) → single source of truth: agregar
 * un valor en la DB obliga a actualizar el código que lo consume.
 */
export const PLACE_STATUSES = placeSubscriptionStatus.enumValues;

/** Union literal de los estados del place que el Hub puede mostrar. */
export type PlaceStatus = (typeof PLACE_STATUSES)[number];

/** Una entrada de la lista "Tus lugares" del Hub. */
export type InboxPlace = {
  id: string;
  slug: string;
  name: string;
  /**
   * Hex del color de acento del place (`theme_config.colors.accent`). `null`
   * si el place todavía no fue setteado vía la saga de creación — el
   * frontend cae a un color default en ese caso.
   */
  themeAccent: string | null;
  status: PlaceStatus;
  /** `true` si el user es owner del place; `false` si sólo es miembro. */
  isOwner: boolean;
  /** Cuándo se unió este user al place (`membership.joined_at`). */
  memberSince: Date;
};

/** Payload completo del Hub (perfil del caller + sus places). */
export type InboxPayload = {
  /**
   * `null` en el caso defensivo "claim válido sin app_user provisionado"
   * (no debería pasar tras ADR-0018, pero la stored function lo cubre).
   */
  displayName: string | null;
  places: InboxPlace[];
};
