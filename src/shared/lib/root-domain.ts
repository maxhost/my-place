// Helper compartido para construir URLs cross-subdomain (apex ↔ hub APP ↔
// subdomain `{slug}.place.community`). Extraído de las pages `/crear` y
// `/login` (donde estaba duplicado) tras la introducción del slice `nav-hub`
// (logout cross-subdomain). Vive en `shared/lib/` porque es transversal a
// múltiples features (no pertenece a ninguna).
//
// `NEXT_PUBLIC_APP_URL` es la fuente de verdad del host público (URL completa
// con scheme + host + puerto opcional, e.g. `https://place.community` en prod
// o `http://localhost:3000` en dev). Esta función retorna sólo el `host`
// (con puerto si corresponde), que es lo que necesitan los `https://${host}/`
// templates. El fallback `place.community` aplica si la env está ausente o
// inválida — defensivo para que el build/SSR no rompa por config faltante
// (la verificación viva es smoke en producción).

export function rootDomain(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://place.community")
      .host;
  } catch {
    return "place.community";
  }
}
