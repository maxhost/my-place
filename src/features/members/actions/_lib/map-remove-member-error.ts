import type { RemoveMemberError } from "../../types";

// Mapeo puro DEFINER error → tag `RemoveMemberError`. Inspecciona `err.code`
// (SQLSTATE) y `err.message` (string del RAISE EXCEPTION). Espejo de
// migration 0020 (`app.remove_member`) — los strings y codes son contract
// con la DB; un drift acá rompe el test puro inmediatamente.
//
// Política anti-info-leak: errores desconocidos colapsan a `'generic'`. El
// caller (Server Action) lo retorna como `{ok: false, error: 'generic'}` y
// la UI muestra copy genérico.
//
// `'unauthorized'` agrupa 28000 + P0002 (sesión rota desde UX). Las 4 ramas
// de aplicación (not_owner / target_is_owner / cannot_self_remove /
// target_not_active_member) se discriminan por message porque las 4 son
// `errcode = 'P0001'` desde la DEFINER (espejo del orden de pre-conditions
// 3→4→5→6 de la migration — la order matter por anti-info-leak).

function readCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null) {
    const candidate = (err as { code?: unknown }).code;
    if (typeof candidate === "string") return candidate;
  }
  return undefined;
}

function readMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "";
}

export function mapRemoveMemberError(err: unknown): RemoveMemberError {
  const code = readCode(err);
  const message = readMessage(err);

  if (code === "28000" || code === "P0002") return "unauthorized";
  if (message.includes("caller is not an owner of this place")) {
    return "not_owner";
  }
  if (message.includes("cannot self-remove")) return "cannot_self_remove";
  if (message.includes("target is an owner; revoke ownership first")) {
    return "target_is_owner";
  }
  if (message.includes("target is not an active member")) {
    return "target_not_active_member";
  }
  return "generic";
}
