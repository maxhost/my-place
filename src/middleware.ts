import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

// Next 15 → middleware.ts (en Next 16 se renombra a proxy.ts).
export default createMiddleware(routing);

export const config = {
  // Todo salvo API, estáticos de Next y archivos con extensión.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
