import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

// Next 16 renombra el archivo de middleware a proxy.ts (ADR-0013). La factory
// de next-intl y el matcher se conservan; solo cambia el nombre del archivo.
export default createMiddleware(routing);

export const config = {
  // Todo salvo API, estáticos de Next y archivos con extensión.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
