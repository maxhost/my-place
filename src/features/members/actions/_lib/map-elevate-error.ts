import type { ElevateError } from "../../types";

// Mapeo puro DEFINER error → tag `ElevateError`. Espejo de migration 0014
// (`app.elevate_to_owner`, Feature D — reutilizada por Feature E). Los strings
// y codes son contract con la DB; un drift acá rompe el test puro inmediatamente.
//
// Política anti-info-leak: errores desconocidos colapsan a `'generic'`.
// `'unauthorized'` agrupa 28000 + P0002 (sesión rota). Las 4 ramas
// `errcode = 'P0001'` (place_not_found / not_owner / target_already_owner /
// target_not_member) se discriminan por message.

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

export function mapElevateError(err: unknown): ElevateError {
  const code = readCode(err);
  const message = readMessage(err);

  if (code === "28000" || code === "P0002") return "unauthorized";
  if (message.includes("place not found")) return "place_not_found";
  if (message.includes("caller is not an owner of this place")) {
    return "not_owner";
  }
  if (message.includes("target is already an owner")) {
    return "target_already_owner";
  }
  if (message.includes("target is not an active member")) {
    return "target_not_member";
  }
  return "generic";
}
