import { getAuthHandler } from "@/shared/lib/auth";

// Route handler first-party de Neon Auth (S4b, ADR-0006). El SDK proxea las
// requests del cliente a Neon Auth y emite la cookie de sesión con `Domain`
// apex (config en `@/shared/lib/auth-config`). El catch-all es `[...path]`
// porque el handler tipa `params: { path: string[] }` (el ejemplo `[...all]`
// del JSDoc del SDK contradice su propio tipo — el ejemplo de `createNeonAuth`
// usa `[...path]`, que es el correcto).
//
// Wrappers perezosos por request: `getAuthHandler()` resuelve el singleton en
// el primer request, NO al cargar el módulo → `next build` no depende de la
// env de Neon Auth (la env es preocupación de runtime).

type RouteContext = { params: Promise<{ path: string[] }> };

export const GET = (req: Request, ctx: RouteContext) =>
  getAuthHandler().GET(req, ctx);
export const POST = (req: Request, ctx: RouteContext) =>
  getAuthHandler().POST(req, ctx);
export const PUT = (req: Request, ctx: RouteContext) =>
  getAuthHandler().PUT(req, ctx);
export const DELETE = (req: Request, ctx: RouteContext) =>
  getAuthHandler().DELETE(req, ctx);
export const PATCH = (req: Request, ctx: RouteContext) =>
  getAuthHandler().PATCH(req, ctx);
