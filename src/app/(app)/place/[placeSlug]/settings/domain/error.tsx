"use client";

// Error boundary del segment `settings/domain` (Phase 2.H.2). Captura el throw
// del async server child `<DomainContent>` (el lazy poll: DB error o fallo no
// colapsado de la Vercel Domains API) y ofrece retry granular sin tirar el
// shell. Thin re-export del primitive `shared/ui/segment-error-boundary`.

export { SegmentErrorBoundary as default } from "@/shared/ui/segment-error-boundary";
