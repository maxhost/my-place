"use client";

// Error boundary root de la zona place (S2 hardening post-review 2026-06-11).
// Antes solo `settings/*` tenía boundary: un throw en la página del place o
// en `invite/[token]` caía al `global-error.tsx` pelado (reemplaza
// <html>/<body>, pierde shell y theme). Con este boundary el layout del
// place sigue vivo y solo el contenido se reemplaza por el fallback con
// retry. Los boundaries más específicos de `settings/*` siguen teniendo
// precedencia. Thin re-export del primitive
// `shared/ui/segment-error-boundary` (copy ES + retry + Sentry).

export { SegmentErrorBoundary as default } from "@/shared/ui/segment-error-boundary";
