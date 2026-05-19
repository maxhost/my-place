// DIAGNÓSTICO TEMPORAL (incidente cutover prod 2026-05-19). El visor de
// runtime logs de Vercel (MCP) agrupa por request y muestra SOLO la primera
// línea truncada (~30 chars). Por eso no sirve loguear varias líneas ni JSON:
// se emite UNA sola línea por request fallido, con el VEREDICTO adelante
// (`[onb] FAIL:<step>|<code>|<msg>`) → legible dentro del truncado.
//
// INVARIANTE: NUNCA secretos (token/password/connstring/claims). El `step`
// y el `code` SQL/clase de error alcanzan para localizar la causa.

interface Tagged {
  onbStep?: string;
  code?: unknown;
  name?: string;
  message?: string;
  cause?: { code?: unknown; message?: string };
}

/** Marca el error con el step donde se originó (si no estaba marcado) y lo
 *  re-lanza el caller. El primero en taggear gana (el más profundo). */
export function tagStep(err: unknown, step: string): unknown {
  if (err && typeof err === "object" && !(err as Tagged).onbStep) {
    (err as Tagged).onbStep = step;
  }
  return err;
}

/** Línea única, veredicto adelante. `step` y `code` en los primeros chars. */
export function onbLine(err: unknown): string {
  const e = (err ?? {}) as Tagged;
  const code = e.code ?? e.cause?.code ?? "";
  const msg = (e.message ?? e.cause?.message ?? String(err)).slice(0, 80);
  return `[onb] FAIL:${e.onbStep ?? "unknown"}|${String(code)}|${e.name ?? ""}|${msg}`;
}
