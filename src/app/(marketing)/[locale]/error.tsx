"use client";

// Error boundary de la zona marketing (S2 hardening post-review 2026-06-11).
// Antes un throw en landing/login/crear/legales caía al `global-error.tsx`
// pelado (reemplaza <html>/<body>). Con este boundary el layout marketing
// sigue vivo y solo el contenido se reemplaza por el fallback con retry.
// Copy hardcodeada ES del primitive: trade-off documentado en
// `shared/ui/segment-error-boundary` (error boundary es Client Component y
// el repo no tiene i18n client-side, ADR-0024) — aplica igual en la zona
// localizada.

export { SegmentErrorBoundary as default } from "@/shared/ui/segment-error-boundary";
