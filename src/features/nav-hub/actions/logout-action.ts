"use server";

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

type LogoutResult = { redirectTo: string };

export async function logoutAction(locale: string): Promise<LogoutResult> {
  try {
    await getAuth().signOut();
  } catch {
    // Best-effort: el flujo sigue al redirect aún si el SDK falla.
  }
  return { redirectTo: `https://${rootDomain()}/${locale}/` };
}
