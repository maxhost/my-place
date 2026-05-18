import createMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { resolveHost } from "@/shared/lib/host-routing";

// Proxy host-based (Next 16 renombra middleware→proxy, ADR-0013). Clasifica el
// host (ADR-0005 §10 · multi-tenancy.md) y:
//   - marketing → delega en el middleware i18n de next-intl (apex con
//     `[locale]`); el i18n NO se duplica, se integra.
//   - inbox / place → rewrite a un path con PREFIJO ESTÁTICO (`/inbox`,
//     `/place/{slug}`). Necesario: Next prohíbe dos segmentos dinámicos
//     distintos en la misma posición de URL aunque estén en route groups
//     distintos, así que `(app)/[placeSlug]` no puede vivir en la raíz junto a
//     `(marketing)/[locale]`. El prefijo es interno (lo pone el proxy), nunca
//     aparece en la URL pública → "URLs públicas = subdominio" se mantiene.
// La existencia real del slug (→ 404) es S5b; acá la page hace el gate
// estructural (`isServiceableSlug`).

const intlMiddleware = createMiddleware(routing);

export default function proxy(req: NextRequest): NextResponse {
  const target = resolveHost(req.headers.get("host") ?? "");

  if (target.zone === "marketing") return intlMiddleware(req);

  const url = req.nextUrl.clone();
  const rest = url.pathname === "/" ? "" : url.pathname;
  url.pathname =
    target.zone === "inbox" ? `/inbox${rest}` : `/place/${target.slug}${rest}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Todo salvo API, estáticos de Next y archivos con extensión.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
