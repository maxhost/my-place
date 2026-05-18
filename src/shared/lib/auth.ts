import {
  type NeonAuth,
  createNeonAuth,
} from "@neondatabase/auth/next/server";
import { buildNeonAuthConfig } from "./auth-config";

// Wiring del SDK de Neon Auth (ADR-0006). El SDK Next.js emite la cookie de
// sesión first-party vía el route handler `app/api/auth/[...path]`. La
// config (env + test-guard del `Domain` apex) vive en `./auth-config` (puro);
// acá sólo el adapter del SDK, cuya correctitud es de tipo/build + preview
// Vercel (la verificación cookie/cross-subdomain viva se difiere a preview —
// gotcha `__Secure-` necesita HTTPS, no localhost).

// Singleton perezoso: la config se resuelve en el primer uso (runtime), NO al
// cargar el módulo → `next build` no depende de la env de Neon Auth (la env
// es preocupación de runtime). El handler se memoiza para no reconstruirse
// por request.
let cachedAuth: NeonAuth | undefined;
export function getAuth(): NeonAuth {
  cachedAuth ??= createNeonAuth(buildNeonAuthConfig());
  return cachedAuth;
}

let cachedHandler: ReturnType<NeonAuth["handler"]> | undefined;
export function getAuthHandler(): ReturnType<NeonAuth["handler"]> {
  cachedHandler ??= getAuth().handler();
  return cachedHandler;
}
