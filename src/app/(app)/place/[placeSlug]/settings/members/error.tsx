"use client";

// Error boundary del segment `settings/members` (Phase 2.H.2). Captura el
// throw del async server child `<MembersContent>` (DB error en la carga de
// members/invitations) y ofrece retry granular sin tirar el shell. Thin
// re-export del primitive `shared/ui/segment-error-boundary`.

export { SegmentErrorBoundary as default } from "@/shared/ui/segment-error-boundary";
