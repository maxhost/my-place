import type { TransferError } from "../../types";

// Mapeo puro DEFINER error → tag `TransferError`. Espejo de migration 0016
// (`app.transfer_founder_ownership`, Feature D — reutilizada por Feature E).
//
// Política anti-info-leak: errores desconocidos colapsan a `'generic'`.
// `'unauthorized'` agrupa 28000 + P0002. Las 4 ramas P0001 (place_not_found /
// not_founder / target_not_owner / cannot_transfer_to_self) se discriminan
// por message — strings disjuntos en migration 0016 por construcción.
//
// Nota: el message canónico DEFINER es `'target is not an owner; elevate first'`
// — el suffix `'; elevate first'` es parte del string. El `includes()` matchea
// el prefijo más corto y estable.

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

export function mapTransferError(err: unknown): TransferError {
  const code = readCode(err);
  const message = readMessage(err);

  if (code === "28000" || code === "P0002") return "unauthorized";
  if (message.includes("place not found")) return "place_not_found";
  if (message.includes("caller is not the founder of this place")) {
    return "not_founder";
  }
  if (message.includes("target is not an owner")) return "target_not_owner";
  if (message.includes("cannot transfer to self")) {
    return "cannot_transfer_to_self";
  }
  return "generic";
}
