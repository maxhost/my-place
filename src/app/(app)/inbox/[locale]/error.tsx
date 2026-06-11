"use client";

// Error boundary de la zona inbox (S2 hardening post-review 2026-06-11).
// Antes un throw en el render del inbox caía al `global-error.tsx` pelado
// (reemplaza <html>/<body>). Con este boundary el layout del inbox sigue
// vivo y solo el contenido se reemplaza por el fallback con retry. Thin
// re-export del primitive `shared/ui/segment-error-boundary` (copy ES +
// retry + Sentry).

export { SegmentErrorBoundary as default } from "@/shared/ui/segment-error-boundary";
