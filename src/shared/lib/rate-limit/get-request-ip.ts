import { headers } from "next/headers";

// IP del request actual derivada del header `x-forwarded-for` (Vercel siempre
// lo setea con la IP real del cliente en index 0, incluso detrás de CDN).
//
// ## Formato esperado
//
// Vercel: `<client-ip>, <vercel-edge-ip>` — index 0 = real client.
// Multi-proxy (CDN → Vercel): `<client-ip>, <cdn-ip>, <vercel-edge-ip>` —
// index 0 sigue siendo real client por convención RFC 7239 §5.2.
//
// ## Fallback `unknown`
//
// Si el header no está (caso local sin proxy, tests, edge no-Vercel):
// devolvemos `"unknown"` literal. Todos los "unknown" comparten 1 bucket en
// Upstash → rate limit MÁS estricto (defense-in-depth: si por algún drift de
// infra perdemos el header en prod, NO desactivamos el limiter, sólo lo
// colapsamos a 1 bucket compartido). Trade-off aceptable.
//
// ## IPv6
//
// `x-forwarded-for` no incluye port (eso es `x-forwarded-port`). El value es
// la IP cruda — IPv6 como `2001:db8::1`, IPv4 como `1.2.3.4`. NO necesitamos
// strip de port.

export async function getRequestIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff === null) return "unknown";
  const first = xff.split(",")[0]?.trim();
  if (first === undefined || first === "") return "unknown";
  return first;
}

/**
 * Variante sync que parsea un header value ya leído. Útil para route handlers
 * que tienen `req.headers` directo + tests que quieren control sobre el input
 * sin mockear `next/headers`.
 */
export function parseForwardedIp(xff: string | null): string {
  if (xff === null) return "unknown";
  const first = xff.split(",")[0]?.trim();
  if (first === undefined || first === "") return "unknown";
  return first;
}
