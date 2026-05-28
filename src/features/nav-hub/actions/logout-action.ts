"use server";

import { z } from "zod";
import { routing } from "@/i18n/routing";
import { getAuth } from "@/shared/lib/auth";
import { rootDomain } from "@/shared/lib/root-domain";

// Server Action del logout del hub (S3 del Hub V1, spec en
// `docs/features/inbox/`). Borde cross-system del SDK Neon Auth: su
// correctitud es de tipo/build + smoke vivo en producción (cross-subdomain
// `*.vercel.app` falla — el smoke real corre en `app.place.community`).
//
// Comportamiento: invoca `signOut()` del SDK (POST `/sign-out` interno que
// elimina la cookie de sesión Domain=`.place.community` — vale para apex y
// todos los subdominios) y retorna la URL del apex localizada. El cliente
// (account-menu) navega con `window.location.assign(redirectTo)` —
// cross-subdomain redirect server-side desde Server Action es frágil en
// Next 16 (verificar en preview); el patrón client-side es seguro y
// testeable.
//
// Best-effort: si `signOut` lanza (red caída, SDK con un edge case), seguimos
// igual al redirect — la cookie podría sobrevivir un instante, pero el user
// vuelve a la landing y la próxima request al apex revalida o re-pide
// credenciales. Logout no es transaccional con la UI.
//
// Phase 1.B — Open-redirect protection. El `locale` se interpola en la URL
// final (`https://${rootDomain()}/${locale}/`); sin validar, un caller
// malicioso (curl/devtools/replay) podría inyectar segmentos arbitrarios
// (`../evil.com`, `\\evil.com`) y construir un redirect hacia un dominio
// adversario. Zod con `z.enum(routing.locales)` (mismo SoT que i18n,
// ADR-0024) cierra el set a los 6 locales soportados. Input inválido →
// fallback al primer locale (canonicamente `es`) — UX-equivalente al locale
// default del cookie i18n: sigue logoutando y manda al apex localizado
// correctamente; el flag no se doxxea al caller (paridad cozytech con el
// resto del slice).

const localeInputSchema = z.enum(routing.locales);

type LogoutResult = { redirectTo: string };

export async function logoutAction(locale: string): Promise<LogoutResult> {
  const parsed = localeInputSchema.safeParse(locale);
  const safeLocale = parsed.success ? parsed.data : routing.locales[0];

  try {
    await getAuth().signOut();
  } catch {
    // Best-effort: el flujo sigue al redirect aún si el SDK falla.
  }
  return { redirectTo: `https://${rootDomain()}/${safeLocale}/` };
}
