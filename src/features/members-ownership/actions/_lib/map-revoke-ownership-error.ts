import type { RevokeError } from "../../types";

// Mapeo puro DEFINER error → tag `RevokeError`. Espejo de migration 0015
// (`app.revoke_ownership`, Feature D — reutilizada por Feature E). La DEFINER
// con mayor superficie de errores de las 3 wrappers del slice (7 ramas
// distintas: unauthorized, not_owner, target_not_owner, cannot_revoke_founder,
// cannot_self_revoke, last_owner, generic).
//
// Política anti-info-leak: errores desconocidos → `'generic'`. `'unauthorized'`
// agrupa 28000 + P0002. Las 5 ramas P0001 se discriminan por message en orden
// estable (no importa el orden de evaluación acá; cada message es prefijo único
// dentro del set de la DEFINER por construcción de migration 0015).
//
// Orden de checks acá NO replica el orden de pre-conditions de la DEFINER —
// usamos el orden que minimiza falsos positivos (`'caller is not an owner'`
// está antes que `'target is not an owner'` porque el primer string es
// estrictamente más largo y específico → no risk de match parcial; ambos
// strings son disjuntos en migration 0015 — sin overlap).

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

export function mapRevokeOwnershipError(err: unknown): RevokeError {
  const code = readCode(err);
  const message = readMessage(err);

  if (code === "28000" || code === "P0002") return "unauthorized";
  if (message.includes("caller is not an owner of this place")) {
    return "not_owner";
  }
  if (message.includes("target is not an owner of this place")) {
    return "target_not_owner";
  }
  if (message.includes("cannot revoke founder ownership")) {
    return "cannot_revoke_founder";
  }
  if (message.includes("cannot self-revoke ownership")) {
    return "cannot_self_revoke";
  }
  if (message.includes("cannot revoke the only remaining owner")) {
    return "last_owner";
  }
  return "generic";
}
