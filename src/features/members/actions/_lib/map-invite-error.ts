import type { InviteError } from "../../types";

// Mapeo puro DEFINER error → tag `InviteError`. Inspecciona `err.code`
// (SQLSTATE) y `err.message` (string del RAISE EXCEPTION). Espejo de
// migration 0018 (`app.create_invitation`) — los strings y codes son
// contract con la DB; un drift acá rompe el test puro inmediatamente.
//
// Política anti-info-leak: errores desconocidos colapsan a `'generic'`
// (NO se exponen al cliente). El caller (Server Action) lo retorna como
// `{ok: false, error: 'generic'}` y la UI muestra copy genérico.
//
// `'unauthorized'` agrupa 28000 (sin claim) + P0002 (claim sin app_user)
// porque ambos son "sesión rota" desde la perspectiva UX. Distinguir no
// agrega valor V1 — un V2 podría discriminar si quisiéramos UX-distinta
// para "tu cuenta nunca arrancó en este place".

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

export function mapInviteError(err: unknown): InviteError {
  const code = readCode(err);
  const message = readMessage(err);

  if (code === "28000" || code === "P0002") return "unauthorized";
  if (message.includes("caller is not an owner of this place")) {
    return "not_owner";
  }
  if (message.includes("expires_at must be in the future")) {
    return "expires_in_past";
  }
  return "generic";
}
