"use client";

// Error boundary root del segment `settings/*` (Phase 2.H.2). Cubre cualquier
// error de render que escape los boundaries más específicos — incluida la page
// de idioma (`settings/page.tsx`), que no tiene contenido streameado propio y
// por eso no necesita su propio `error.tsx`. Thin re-export del primitive
// genérico `shared/ui/segment-error-boundary` (copy ES + retry + Sentry).

export { SegmentErrorBoundary as default } from "@/shared/ui/segment-error-boundary";
