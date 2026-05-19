// DIAGNÓSTICO TEMPORAL (incidente cutover prod 2026-05-19): el camino de
// creación de place no logueaba nada y el throw lo traga el `catch` del
// wizard → Vercel no mostraba el error. Logging con prefijo `[onboarding]`
// para filtrar en Vercel runtime logs (query="onboarding").
//
// INVARIANTE: NUNCA loguear secretos — token de sesión, password, connection
// string, ni el payload de claims. Sólo presencia/longitud/códigos/`sub`
// (id opaco, sirve de correlación). Se recorta a logging operativo mínimo
// una vez hallada la causa raíz (no es observabilidad permanente).

export function obs(step: string, extra?: Record<string, unknown>): void {
  console.log(`[onboarding] ${step}`, extra ? JSON.stringify(extra) : "");
}

export function obsErr(step: string, err: unknown): void {
  const e = err as {
    name?: string;
    code?: unknown;
    message?: string;
    cause?: unknown;
  };
  const cause = e?.cause as { code?: unknown; message?: string } | undefined;
  console.error(
    `[onboarding] ERROR ${step}`,
    JSON.stringify({
      name: e?.name,
      code: e?.code,
      message: e?.message,
      causeCode: cause?.code,
      causeMessage: cause?.message,
    }),
  );
}
