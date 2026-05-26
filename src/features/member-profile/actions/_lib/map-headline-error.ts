import type { HeadlineError } from "../../types";

// Mapeo puro DEFINER error → tag `HeadlineError`. Espejo de migration 0017
// (`app.update_my_headline`). Inspecciona `err.code` + `err.message`.
// Política anti-info-leak: unknown → `'generic'`.
//
// `'too_long'` NO se mapea acá: zod app-side rechaza ANTES de invocar la
// DEFINER (ver `_lib/schemas.ts`). El CHECK constraint `23514` es
// defense-in-depth — si llegara, cae a `'generic'` (situación de bug zod,
// no esperada runtime normal).

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

export function mapHeadlineError(err: unknown): HeadlineError {
  const code = readCode(err);
  const message = readMessage(err);

  if (code === "28000" || code === "P0002") return "unauthorized";
  if (message.includes("caller is not an active member of this place")) {
    return "not_member";
  }
  return "generic";
}
